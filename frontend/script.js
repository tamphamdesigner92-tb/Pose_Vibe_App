/**
 * Vibe Coding - Pose Tracker Frontend Core Logic
 * Thiết kế để quản lý trạng thái WebCam, Canvas và Hệ thống thông báo.
 */

class PoseTrackerUI {
    constructor() {
        // Cấu hình ràng buộc nghiệp vụ (Business Rules)
        this.MAX_NOTIFICATIONS = 10;
        this.isPersonDetected = false;
        this.isWSConnected = false;

        // Khởi tạo liên kết DOM Elements
        this.video = document.getElementById('webcam');
        this.canvas = document.getElementById('overlay-canvas');
        this.ctx = this.canvas.getContext('2d');
        this.placeholder = document.getElementById('camera-placeholder');
        this.logContainer = document.getElementById('notification-log');
        this.detectionBadge = document.getElementById('detection-badge');
        this.latencyBadge = document.getElementById('latency-badge');
        this.statusDot = document.getElementById('status-dot');
        this.statusText = document.getElementById('status-text');
        
        // Nút mô phỏng (Mock Controls)
        this.btnMockConnect = document.getElementById('btn-mock-connect');
        this.btnMockDetect = document.getElementById('btn-mock-detect');

        this.init();
    }

    init() {
        this.bindEvents();
        this.setupWebcam();
        this.handleResize();
        
        // Kích hoạt thông báo hệ thống chào mừng ban đầu
        this.log('Hệ thống Core UI đã được khởi tạo thành công.', 'info');
        this.log('Đang chờ tín hiệu kết nối từ WebSocket server backend...', 'warning');
    }

    bindEvents() {
        window.addEventListener('resize', () => this.handleResize());
        
        // Lắng nghe sự kiện click mô phỏng để lập trình viên kiểm thử UI lập tức
        this.btnMockConnect.addEventListener('click', () => this.toggleWSConnection());
        this.btnMockDetect.addEventListener('click', () => this.simulateDetectionState());
    }

    /**
     * Khởi tạo và xử lý luồng luân chuyển camera phần cứng
     */
    async setupWebcam() {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                video: {
                    width: { ideal: 1280 },
                    height: { ideal: 720 },
                    facingMode: "user"
                },
                audio: false
            });
            
            this.video.srcObject = stream;
            this.video.onloadedmetadata = () => {
                // Ẩn lớp phủ loading khi camera đã sẵn sàng phát tín hiệu
                this.placeholder.classList.add('hidden');
                this.log('Thiết bị Camera Mac đã được cấp quyền và kết nối mượt mà.', 'success');
                this.handleResize();
                this.startRenderLoop();
            };
        } catch (error) {
            console.error("Lỗi đồng bộ camera:", error);
            this.placeholder.innerHTML = `<p style="color: #ff4a4a; font-weight: 600;">LỖI: Không thể truy cập Camera. Vui lòng cấp quyền trong System Preferences.</p>`;
            this.log('Truy cập camera thất bại: Quyền bị từ chối hoặc thiết bị bận.', 'error');
        }
    }

    /**
     * Đồng bộ ma trận độ phân giải Canvas trùng khớp chính xác với khung hình Video thực tế
     */
    handleResize() {
        const width = this.video.videoWidth || this.video.clientWidth;
        const height = this.video.videoHeight || this.video.clientHeight;
        
        this.canvas.width = width;
        this.canvas.height = height;
    }

    /**
     * Quản lý tập trung luồng thông báo hệ thống (Tối đa 10 dòng, tự động cuộn xuống dưới cùng)
     */
    log(message, type = 'info') {
        const now = new Date();
        const timestamp = now.toTimeString().split(' ')[0] + '.' + String(now.getMilliseconds()).padStart(3, '0');

        const noteItem = document.createElement('div');
        noteItem.className = `note-item ${type}`;
        noteItem.innerHTML = `
            <span class="time">${timestamp}</span>
            <span class="message">${message}</span>
        `;

        this.logContainer.appendChild(noteItem);

        // Quy tắc nghiệp vụ nghiêm ngặt: Giới hạn lưu trữ tối đa 10 thông báo gần nhất
        while (this.logContainer.children.length > this.MAX_NOTIFICATIONS) {
            this.logContainer.removeChild(this.logContainer.firstChild);
        }

        // Tự động cuộn mượt mà đến phần tử thông báo mới nhất vừa chèn
        this.logContainer.scrollTop = this.logContainer.scrollHeight;
    }

    /**
     * Cập nhật phản hồi trạng thái nhận diện thực tế
     */
    setDetectionState(hasPerson) {
        this.isPersonDetected = hasPerson;
        if (hasPerson) {
            this.detectionBadge.textContent = "Đang nhận diện tư thế";
            this.detectionBadge.className = "badge badge-success";
        } else {
            this.detectionBadge.textContent = "Không nhận diện được người";
            this.detectionBadge.className = "badge badge-error";
        }
    }

    /**
     * MÔ PHỎNG: Trạng thái kết nối WebSocket
     */
    toggleWSConnection() {
        this.isWSConnected = !this.isWSConnected;
        if (this.isWSConnected) {
            this.statusDot.className = "status-dot connected";
            this.statusText.textContent = "ĐÃ KẾT NỐI (WS)";
            this.log('Kênh kết nối dữ liệu WebSocket thời gian thực đã MỞ.', 'success');
        } else {
            this.statusDot.className = "status-dot disconnected";
            this.statusText.textContent = "MẤT KẾT NỐI (WS)";
            this.log('Kênh kết nối WebSocket đã bị ĐÓNG hoặc NGẮT.', 'error');
        }
    }

    /**
     * MÔ PHỎNG: Biến động trạng thái tìm thấy con người trong frame hình
     */
    simulateDetectionState() {
        this.setDetectionState(!this.isPersonDetected);
        if (this.isPersonDetected) {
            this.log('MediaPipe: Phát hiện thực thể người trong vùng quét.', 'success');
            this.latencyBadge.textContent = "FPS: 30 | Latency: 32ms";
        } else {
            this.log('MediaPipe: Cảnh báo - Mất dấu thực thể hoặc khung hình trống.', 'warning');
            this.latencyBadge.textContent = "FPS: -- | Latency: --ms";
        }
    }

    /**
     * Vòng lặp dựng hình liên tục (High-performance Animation Render Loop) dưới 100ms
     */
    startRenderLoop() {
        const loop = () => {
            // Xóa sạch khung hình cũ để tối ưu bộ nhớ đệm đồ họa Canvas
            this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
            
            // Nếu phát hiện có người, tiến hành vẽ bộ xương stick figure giả lập đồ họa kỹ thuật thuật toán
            if (this.isPersonDetected) {
                this.drawProceduralSkeleton();
            }
            
            requestAnimationFrame(loop);
        };
        requestAnimationFrame(loop);
    }

    /**
     * Kỹ thuật vẽ đồ họa vector Skeleton đồng bộ mượt mà mô phỏng thuật toán MediaPipe
     */
    drawProceduralSkeleton() {
        const w = this.canvas.width;
        const h = this.canvas.height;
        const ticks = Date.now() * 0.003; // Điều phối nhịp sinh học chuyển động mượt mà
        
        // Tính toán các điểm nút tọa độ giả lập chuyển động tự nhiên sinh học
        const head = { x: w * 0.5, y: h * 0.28 + Math.sin(ticks) * 8 };
        const neck = { x: w * 0.5, y: h * 0.38 + Math.sin(ticks) * 6 };
        const shoulderL = { x: w * 0.38, y: h * 0.40 };
        const shoulderR = { x: w * 0.62, y: h * 0.40 };
        const elbowL = { x: w * 0.32, y: h * 0.54 + Math.cos(ticks) * 12 };
        const elbowR = { x: w * 0.68, y: h * 0.52 + Math.sin(ticks) * 12 };
        const wristL = { x: w * 0.30, y: h * 0.66 + Math.cos(ticks) * 20 };
        const wristR = { x: w * 0.70, y: h * 0.34 + Math.sin(ticks * 1.6) * 25 }; // Tay phải giơ cao cử động
        
        const joints = [head, neck, shoulderL, shoulderR, elbowL, elbowR, wristL, wristR];
        const bones = [
            [head, neck], [shoulderL, shoulderR], [neck, shoulderL], [neck, shoulderR],
            [shoulderL, elbowL], [elbowL, wristL], [shoulderR, elbowR], [elbowR, wristR]
        ];

        // Khởi tạo các cấu trúc thuộc tính vẽ đường nối (Xương) với hiệu ứng Neon Glowing kỹ thuật số
        this.ctx.strokeStyle = '#00f0ff';
        this.ctx.lineWidth = 4;
        this.ctx.lineCap = 'round';
        this.ctx.lineJoin = 'round';
        this.ctx.shadowBlur = 8;
        this.ctx.shadowColor = '#00f0ff';

        bones.forEach(([from, to]) => {
            this.ctx.beginPath();
            this.ctx.moveTo(from.x, from.y);
            this.ctx.lineTo(to.x, to.y);
            this.ctx.stroke();
        });

        // Tái cấu trúc thuộc tính vẽ các điểm khớp nối (Khớp xương tròn)
        this.ctx.fillStyle = '#00ff66';
        this.ctx.shadowBlur = 10;
        this.ctx.shadowColor = '#00ff66';

        joints.forEach(joint => {
            this.ctx.beginPath();
            this.ctx.arc(joint.x, joint.y, 5, 0, Math.PI * 2);
            this.ctx.fill();
        });

        // Khôi phục bộ cấu hình mặc định tránh tràn hiệu ứng bóng mờ (Shadow Bleeding)
        this.ctx.shadowBlur = 0;
    }
}

// Khởi chạy Module ứng dụng khi tài nguyên DOM đã sẵn sàng vững chắc
document.addEventListener('DOMContentLoaded', () => {
    window.trackerApp = new PoseTrackerUI();
});