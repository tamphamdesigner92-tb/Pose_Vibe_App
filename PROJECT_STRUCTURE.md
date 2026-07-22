# 📐 PROJECT_STRUCTURE.md — Pose_Vibe_App

> Ứng dụng nhận diện tư thế (Pose), ngũ quan khuôn mặt (Face Mesh) và khớp ngón tay (Hand) theo thời gian thực, sử dụng **MediaPipe Tasks API** + **FastAPI WebSocket** + **HTML5 Canvas**.

---

## 🗂️ Cây thư mục

```
Pose_Vibe_App/
│
├── backend/                          # ── Python FastAPI + MediaPipe AI Server
│   ├── main.py                       # Entry point: FastAPI app + WebSocket endpoint /ws
│   ├── pose_tracker.py               # Lõi AI: khởi tạo 3 landmarker, suy luận song song, trích xuất landmark
│   ├── requirements.txt              # Dependencies Python (FastAPI, uvicorn, mediapipe, opencv, numpy)
│   ├── models/                       # Thư mục chứa model bundle (.task) — tự tải khi chạy lần đầu
│   │   ├── pose_landmarker_lite.task # BlazePose Pose (lite) — full body 33 khớp
│   │   ├── face_landmarker.task      # Face Mesh — 478 điểm (gửi tập con ngũ quan + iris)
│   │   └── hand_landmarker.task      # Hand — 21 khớp / bàn tay
│   └── venv/                         # Môi trường ảo Python (bị .gitignore)
│
├── frontend/                         # ── Web UI (HTML + CSS + JS thuần, không framework)
│   ├── index.html                    # Giao diện chính: camera + canvas overlay + bảng thông báo
│   ├── script.js                     # Logic: webcam, WebSocket, gửi frame, vẽ skeleton neon
│   └── style.css                     # Theme tối, layout 60/40, badge trạng thái, log stream
│
├── run_app.bat                       # Script khởi động tự động trên Windows
├── .gitignore                        # Bỏ qua venv/, __pycache__/, models/, .env, .DS_Store...
└── PROJECT_STRUCTURE.md              # File này
```

---

## 🏗️ Kiến trúc tổng quan

```
┌─────────────────────────────────────────────────────────┐
│                     FRONTEND (Browser)                   │
│                                                          │
│  ┌──────────┐   ┌───────────────┐   ┌────────────────┐  │
│  │  Webcam  │──▶│ Capture Canvas│──▶│  WebSocket     │  │
│  │ (video)  │   │ (640px, JPEG  │   │  ws://...:8888  │  │
│  │          │   │  quality 0.6) │   │  /ws            │  │
│  └──────────┘   └───────────────┘   └───────┬────────┘  │
│                                              │           │
│  ┌───────────────────────────────────────────▼────────┐  │
│  │              Overlay Canvas (2D Context)            │  │
│  │  • Skeleton thân người (15 khớp BlazePose)        │  │
│  │  • Ngũ quan khuôn mặt (FACEMESH_CONTOURS + IRIS)  │  │
│  │  • 21 khớp ngón tay (HAND_CONNECTIONS)            │  │
│  │  Hiệu ứng neon, bảng màu phân biệt đa thực thể    │  │
│  └────────────────────────────────────────────────────┘  │
│                                                          │
│  ┌────────────────────────────────────────────────────┐  │
│  │              Control Panel (40% width)             │  │
│  │  • Trạng thái kết nối WS (dot xanh/đỏ)             │  │
│  │  • Badge nhận diện (số người/mặt/tay)             │  │
│  │  • Badge FPS + Latency khứ hồi                     │  │
│  │  • Log stream (tối đa 10 dòng, tự cuộn)            │  │
│  │  • Nút: Kết nối lại / Bật-Tắt nhận diện            │  │
│  └────────────────────────────────────────────────────┘  │
└─────────────────────────┬───────────────────────────────┘
                          │ JSON { image: base64, timestamp }
                          ▼
┌─────────────────────────────────────────────────────────┐
│                  BACKEND (FastAPI + Uvicorn)              │
│                   ws://127.0.0.1:8888/ws                  │
│                                                          │
│  ┌────────────────────────────────────────────────────┐  │
│  │                WebSocket Endpoint /ws               │  │
│  │  • Nhận JSON { image, timestamp }                   │  │
│  │  • Chạy suy luận trên ThreadPoolExecutor (asyncio)  │  │
│  │  • Trả JSON { success, persons, faces, hands,      │  │
│  │    message, timestamp }                             │  │
│  └──────────────────────┬─────────────────────────────┘  │
│                         │                                │
│  ┌──────────────────────▼─────────────────────────────┐  │
│  │              PoseTracker (pose_tracker.py)          │  │
│  │                                                     │  │
│  │  ┌─────────────┐ ┌─────────────┐ ┌───────────────┐ │  │
│  │  │PoseLandmarker│ │FaceLandmarker│ │HandLandmarker│ │  │
│  │  │  (max 4)    │ │  (max 2)    │ │   (max 4)     │ │  │
│  │  └──────┬──────┘ └──────┬──────┘ └──────┬────────┘ │  │
│  │         │               │               │           │  │
│  │         ▼               ▼               ▼           │  │
│  │  ┌──────────────────────────────────────────────┐   │  │
│  │  │     ThreadPoolExecutor (3 workers)           │   │  │
│  │  │  Chạy 3 model SONG SONG → giảm độ trễ        │   │  │
│  │  └──────────────────────────────────────────────┘   │  │
│  │                                                     │  │
│  │  • GPU delegate (Metal) trên macOS/Linux           │  │
│  │  • CPU delegate + đa luồng OpenCV trên Windows      │  │
│  │  • Tự tải model (.task) từ Google Storage          │  │
│  │  • Giải mã base64 → OpenCV BGR → RGBA → mp.Image    │  │
│  └─────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────┘
```

---

## 📦 Chi tiết từng module

### Backend

| File | Vai trò |
|---|---|
| `backend/main.py` | FastAPI app + endpoint WebSocket `/ws`. Nhận frame base64 từ frontend, delegate sang `PoseTracker.process_frame()` qua `loop.run_in_executor()` để không block event loop. Trả về JSON chứa `persons`, `faces`, `hands`. Chạy Uvicorn ở `127.0.0.1:8888`. |
| `backend/pose_tracker.py` | Lõi AI. Khởi tạo 3 MediaPipe landmarker (Pose/Face/Hand) ở chế độ `VIDEO`. Chạy suy luận **song song** trên `ThreadPoolExecutor(max_workers=3)`. Tự động chọn GPU delegate (macOS Metal / Linux) hoặc CPU delegate (Windows). Trích xuất tập con landmark tối ưu băng thông trước khi gửi. |
| `backend/requirements.txt` | `fastapi`, `uvicorn`, `websockets`, `opencv-python-headless`, `numpy`, `protobuf`, `mediapipe`. |
| `backend/models/*.task` | Model bundle chính thức Google. Tự động tải về ở lần chạy đầu (`_ensure_model_downloaded`). Bị `.gitignore`. |

### Frontend

| File | Vai trò |
|---|---|
| `frontend/index.html` | Cấu trúc DOM: `visual-panel` (60%) chứa `<video>` + `<canvas>` overlay, `control-panel` (40%) chứa log + nút điều khiển. |
| `frontend/script.js` | Class `PoseTrackerUI` — quản lý toàn bộ: quyền webcam, kết nối WebSocket (auto-reconnect 3s), chụp frame định kỳ 100ms (~10 FPS), vẽ skeleton neon (thân người / ngũ quan / ngón tay), tính FPS & latency khứ hồi, log stream có giới hạn. |
| `frontend/style.css` | Theme tối (`#0a0b0e`), layout flexbox 60/40, hiệu ứng neon (shadowBlur), badge trạng thái, scrollbar tùy chỉnh, animation fadeIn. |

### Scripts khởi động

| File | Vai trò |
|---|---|
| `run_app.bat` | Windows: kiểm tra Python 3.10–3.12, tạo venv nếu thiếu, `pip install -r requirements.txt`, chờ port 8888 mở, tự mở trình duyệt `frontend/index.html`. |

---

## 🔄 Luồng dữ liệu (Data Flow)

```
1. Browser                    →  getUserMedia() mở webcam (1280×720)
2. Capture Canvas (100ms)      →  drawImage → toDataURL('image/jpeg', 0.6) → base64
3. WebSocket                  →  JSON { image: "data:image/jpeg;base64,...", timestamp: Date.now() }
4. FastAPI /ws                →  asyncio run_in_executor → PoseTracker.process_frame(base64)
5. PoseTracker                →  decode base64 → cv2.imdecode → cvtColor(BGR→RGBA) → mp.Image
6. ThreadPoolExecutor(3)      →  PoseLandmarker.detect_for_video()  ┐
                                   FaceLandmarker.detect_for_video() ├─ song song
                                   HandLandmarker.detect_for_video() ┘
7. Extract landmarks          →  persons[] (15 khớp), faces[] (ngũ quan+iris), hands[] (21 khớp/tay)
8. FastAPI /ws                →  JSON { success, persons, faces, hands, message, timestamp }
9. Browser                    →  parse JSON → drawSkeleton() trên overlay canvas (neon effect)
10. Badge + Log               →  cập nhật FPS, latency, trạng thái nhận diện
```

---

## ⚙️ Cấu hình & giới hạn nghiệp vụ

| Thông số | Giá trị | Vị trí |
|---|---|---|
| WebSocket URL | `ws://127.0.0.1:8888/ws` | `main.py` + `script.js` |
| Gửi frame | 100ms (~10 FPS) | `script.js: SEND_INTERVAL_MS` |
| Capture width | 640px | `script.js: CAPTURE_WIDTH` |
| JPEG quality | 0.6 | `script.js: JPEG_QUALITY` |
| Max persons | 4 | `pose_tracker.py: MAX_PERSONS` |
| Max faces | 2 | `pose_tracker.py: MAX_FACES` |
| Max hands | 4 | `pose_tracker.py: MAX_HANDS` |
| GPU delegate | macOS (Metal) + Linux | `pose_tracker.py: _gpu_delegate_supported()` |
| CPU đa luồng | Windows (OpenCV, tối đa 8 threads) | `pose_tracker.py: _configure_platform_optimizations()` |
| Python yêu cầu | 3.10 – 3.12 (MediaPipe không hỗ trợ 3.13+) | `run_app.bat` / `run_app.sh` |
| Model format | `.task` (Tasks API, float16) | `pose_tracker.py: *_MODEL_URL` |
| Auto-reconnect WS | 3 giây | `script.js: scheduleReconnect()` |
| Max notifications | 10 dòng | `script.js: MAX_NOTIFICATIONS` |

---

## 🚀 Cách chạy nhanh

**Windows:**
```bat
run_app.bat
```

Script tự động: tạo venv → cài dependencies → tải model → khởi động server → mở trình duyệt.

---

## 🛠️ Công nghệ sử dụng

| Tầng | Công nghệ |
|---|---|
| AI / Vision | Google MediaPipe Tasks API (Pose, Face Mesh, Hand Landmarker) |
| Backend | Python 3.10–3.12, FastAPI, Uvicorn, WebSockets |
| Image processing | OpenCV (opencv-python-headless), NumPy |
| Frontend | HTML5, CSS3, Vanilla JavaScript (ES6+) |
| Realtime | WebSocket (JSON over TCP) |
| GPU | MediaPipe GPU delegate (Metal trên macOS, CPU fallback trên Windows) |

---

## 📌 Ghi chú

- **Model `.task`** bị `.gitignore` — tự tải về ở lần chạy đầu tiên (cần Internet).
- **`backend/venv/`** bị `.gitignore` — script tự tạo.
- Toạ độ landmark từ MediaPipe là **chuẩn hoá 0..1**; frontend nhân với `canvas.width/height` để vẽ.
- Canvas overlay dùng `transform: scaleX(-1)` để khớp với hiệu ứng gương của `<video>`.
- Pipeline bắt buộc dùng ảnh **RGBA** (4 kênh) cho cả CPU lẫn GPU delegate — tránh crash C++ khi đưa ảnh RGB (3 kênh) vào GPU.
