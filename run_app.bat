@echo off
chcp 65001 >nul 2>&1
setlocal EnableDelayedExpansion

REM Tự động di chuyển vào thư mục chứa file script này để tránh lỗi sai đường dẫn
cd /d "%~dp0"

echo ========================================================
echo 🚀 HỆ THỐNG KHỞI ĐỘNG VIBE CODING POSE TRACKER AUTOMATION
echo ========================================================

REM 1. Kiểm tra cấu trúc thư mục dự án
if not exist "backend\" (
    echo ❌ Lỗi: Không tìm thấy thư mục 'backend'.
    echo 💡 Hãy đảm bảo bạn lưu file này ở THƯ MỤC GỐC của dự án ^(cùng cấp với thư mục backend và frontend^).
    exit /b 1
)
if not exist "frontend\" (
    echo ❌ Lỗi: Không tìm thấy thư mục 'frontend'.
    echo 💡 Hãy đảm bảo bạn lưu file này ở THƯ MỤC GỐC của dự án ^(cùng cấp với thư mục backend và frontend^).
    exit /b 1
)

REM 2. Kiểm tra và quản lý môi trường ảo (venv)
REM MediaPipe (API mp.solutions.pose) chỉ hỗ trợ Python 3.9 - 3.12.
REM Python 3.13/3.14 sẽ cài phải bản wheel thiếu module 'solutions' -> lỗi AttributeError.
REM Ưu tiên dùng Python Launcher (py -3.12), sau đó python3.12 / python trên PATH.
set "PYTHON_BIN="

for %%V in (3.12 3.11 3.10) do (
    if not defined PYTHON_BIN (
        py -%%V -c "import sys; sys.exit(0)" >nul 2>&1
        if !errorlevel! equ 0 set "PYTHON_BIN=py -%%V"
    )
)

if not defined PYTHON_BIN (
    for %%P in (python3.12 python3.11 python3.10 python) do (
        if not defined PYTHON_BIN (
            %%P -c "import sys; v=sys.version_info; sys.exit(0 if (3,10)<=v[:2]<=(3,12) else 1)" >nul 2>&1
            if !errorlevel! equ 0 set "PYTHON_BIN=%%P"
        )
    )
)

if not defined PYTHON_BIN (
    echo ❌ Lỗi: Cần Python 3.10 - 3.12 để chạy MediaPipe ^(mp.solutions^).
    echo 💡 Tải tại https://www.python.org/downloads/ và chọn "Add Python to PATH".
    echo 💡 Hoặc cài Python Launcher rồi chạy: py -3.12
    exit /b 1
)

if not exist "backend\venv\" (
    echo 📦 Không tìm thấy môi trường ảo. Tiến hành khởi tạo venv bằng %PYTHON_BIN%...
    %PYTHON_BIN% -m venv backend\venv
    if errorlevel 1 (
        echo ❌ Lỗi: Không thể tạo môi trường ảo Python. Vui lòng kiểm tra lại phiên bản Python.
        exit /b 1
    )
)

REM Kích hoạt môi trường ảo
echo 🔌 Kích hoạt môi trường ảo Python (venv)...
call backend\venv\Scripts\activate.bat
if errorlevel 1 (
    echo ❌ Lỗi: Không thể kích hoạt môi trường ảo Python.
    exit /b 1
)

REM 3. Kiểm tra và tự động cập nhật thư viện phụ thuộc
echo 🔄 Đang đối chiếu các thư viện phụ thuộc từ requirements.txt...
python -m pip install --upgrade pip -q
python -m pip install -r backend\requirements.txt

if errorlevel 1 (
    echo ❌ Lỗi: Quá trình cài đặt thư viện thất bại.
    exit /b 1
)
echo ✅ Hệ thống thư viện đã đầy đủ và sẵn sàng!

REM 4. Khởi động FastAPI server ở chế độ tiền cảnh (Foreground)
REM Server FastAPI phục vụ cả HTTP (frontend) lẫn WebSocket (/ws) trên cùng port 8888.
REM Trình duyệt truy cập http://127.0.0.1:8888/ sẽ nhận trang frontend trực tiếp.
echo ⚡ Đang khởi động Uvicorn Server tại địa chỉ http://127.0.0.1:8888 ...

REM 5. Tự động mở trình duyệt sau khi server sẵn sàng (chờ 4 giây để Uvicorn khởi động xong)
start "" cmd /c "timeout /t 4 /nobreak >nul && start http://127.0.0.1:8888/"

cd backend
python main.py

endlocal
