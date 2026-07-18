#!/bin/bash

# Tự động di chuyển vào thư mục chứa file script này để tránh lỗi sai đường dẫn
CDPATH="" cd -- "$(dirname -- "$0")" || exit

echo "========================================================"
echo "🚀 HỆ THỐNG KHỞI ĐỘNG VIBE CODING POSE TRACKER AUTOMATION"
echo "========================================================"

# 1. Kiểm tra cấu trúc thư mục dự án
if [ ! -d "backend" ] || [ ! -d "frontend" ]; then
    echo "❌ Lỗi: Không tìm thấy thư mục 'backend' hoặc 'frontend'."
    echo "💡 Hãy đảm bảo bạn lưu file này ở THƯ MỤC GỐC của dự án (cùng cấp với thư mục backend và frontend)."
    exit 1
fi

# 2. Kiểm tra và quản lý môi trường ảo (venv)
# MediaPipe (API mp.solutions.pose) chỉ hỗ trợ Python 3.9 - 3.12.
# Python 3.13/3.14 sẽ cài phải bản wheel thiếu module 'solutions' -> lỗi AttributeError.
# Ưu tiên dùng python3.12, sau đó 3.11 / 3.10.
PYTHON_BIN=""
for candidate in python3.12 python3.11 python3.10; do
    if command -v "$candidate" >/dev/null 2>&1; then
        PYTHON_BIN="$candidate"
        break
    fi
done
if [ -z "$PYTHON_BIN" ]; then
    echo "❌ Lỗi: Cần Python 3.10 - 3.12 để chạy MediaPipe (mp.solutions)."
    echo "💡 Cài đặt qua Homebrew, ví dụ: brew install python@3.12"
    exit 1
fi

if [ ! -d "backend/venv" ]; then
    echo "📦 Không tìm thấy môi trường ảo. Tiến hành khởi tạo venv bằng $PYTHON_BIN..."
    "$PYTHON_BIN" -m venv backend/venv
    if [ $? -ne 0 ]; then
        echo "❌ Lỗi: Không thể tạo môi trường ảo Python. Vui lòng kiểm tra lại phiên bản python3."
        exit 1
    fi
fi

# Kích hoạt môi trường ảo
echo "🔌 Kích hoạt môi trường ảo Python (venv)..."
source backend/venv/bin/activate

# 3. Kiểm tra và tự động cập nhật thư viện phụ thuộc
echo "🔄 Đang đối chiếu các thư viện phụ thuộc từ requirements.txt..."
pip install --upgrade pip -q
pip install -r backend/requirements.txt

if [ $? -ne 0 ]; then
    echo "❌ Lỗi: Quá trình cài đặt thư viện thất bại."
    exit 1
fi
echo "✅ Hệ thống thư viện đã đầy đủ và sẵn sàng!"

# 4. Tạo luồng chạy ngầm để chờ Port 8000 mở và tự động kích hoạt trình duyệt
(
    echo "⏳ Đang lắng nghe tín hiệu từ WebSocket Server tại port 8010..."
    # Dùng nc (netcat) tích hợp sẵn trên macOS để quét trạng thái cổng kết nối
    while ! nc -z 127.0.0.1 8010; do
        sleep 0.5
    done
    echo "🖥️  [BACKEND READY] Server đã phản hồi ổn định!"
    echo "🌐 Đang tự động kích hoạt giao diện Frontend trên trình duyệt..."
    open frontend/index.html
) &

# 5. Khởi động FastAPI server ở chế độ tiền cảnh (Foreground) để lập trình viên theo dõi log
echo "⚡ Đang chạy Uvicorn Server tại địa chỉ ws://127.0.0.1:8010/ws..."
cd backend || exit
python3 main.py