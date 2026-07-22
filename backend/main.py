import os
import uvicorn
import asyncio
from pathlib import Path
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pose_tracker import PoseTracker
import time

app = FastAPI(title="Vibe Coding - Pose Tracker Backend")

# Kích hoạt CORS để cho phép Frontend chạy local file hoặc dev-server kết nối tự do
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Phục vụ frontend (HTML/CSS/JS) trực tiếp từ FastAPI — chỉ cần 1 server duy nhất
_FRONTEND_DIR = Path(__file__).resolve().parent.parent / "frontend"
if _FRONTEND_DIR.is_dir():
    # Mount các file tĩnh (CSS, JS) dưới /static
    app.mount("/static", StaticFiles(directory=str(_FRONTEND_DIR)), name="static")

# Khởi tạo dịch vụ phân tích tư thế
tracker = PoseTracker()

@app.get("/")
async def serve_index():
    """Phục vụ trang chính frontend tại http://127.0.0.1:8888/"""
    index_path = _FRONTEND_DIR / "index.html"
    if index_path.is_file():
        return FileResponse(str(index_path), media_type="text/html")
    return {"detail": "Frontend directory not found"}

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    print("⚡ Cổng WebSocket kết nối thành công với Client.")
    
    try:
        while True:
            # Nhận gói dữ liệu JSON từ Frontend
            data = await websocket.receive_json()
            
            base64_frame = data.get("image")
            client_timestamp = data.get("timestamp", 0) # Nhãn thời gian để tính toán Latency

            if not base64_frame:
                await websocket.send_json({
                    "success": False,
                    "persons": [],
                    "faces": [],
                    "hands": [],
                    "message": "Dữ liệu hình ảnh trống.",
                    "timestamp": client_timestamp
                })
                continue

            # Thực thi xử lý AI (Pose + Face + Hand chạy song song bên trong tracker) trên
            # threadpool để không chặn vòng lặp sự kiện asyncio trong lúc suy luận.
            start_process_time = time.time()
            loop = asyncio.get_running_loop()
            is_detected, payload, message = await loop.run_in_executor(
                None, tracker.process_frame, base64_frame
            )
            process_duration_ms = (time.time() - start_process_time) * 1000

            # Đóng gói và gửi phản hồi ngay lập tức
            await websocket.send_json({
                "success": is_detected,
                "persons": payload["persons"],
                "faces": payload["faces"],
                "hands": payload["hands"],
                "message": f"{message} (Backend xử lý: {process_duration_ms:.1f}ms)",
                "timestamp": client_timestamp  # Trả lại nhãn thời gian gốc cho Client
            })

    except WebSocketDisconnect:
        print("❌ Kênh kết nối WebSocket đã bị đóng bởi Client.")
    except Exception as e:
        print(f"⚠️ Phát hiện sự cố trên đường truyền WebSocket: {e}")

if __name__ == "__main__":
    # Chạy uvicorn server tại local port 8888 (tránh trùng cổng của CrabbyCut)
    uvicorn.run("main:app", host="127.0.0.1", port=8888, reload=True)