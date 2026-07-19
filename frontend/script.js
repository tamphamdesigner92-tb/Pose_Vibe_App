/**
 * Vibe Coding - Pose Tracker Frontend Core Logic
 * Quản lý WebCam, kết nối WebSocket thật tới backend, gửi frame và vẽ skeleton thật.
 */

// Topology cố định của MediaPipe (danh sách cặp chỉ số điểm cần nối) - khớp chính xác với
// tập con landmark mà backend gửi lên (FACEMESH_CONTOURS + FACEMESH_IRISES, HAND_CONNECTIONS).
const FACE_CONTOUR_EDGES = [[0,267],[7,163],[10,338],[13,312],[14,317],[17,314],[21,54],[33,7],[33,246],[37,0],[39,37],[40,39],[46,53],[52,65],[53,52],[54,103],[58,132],[61,146],[61,185],[63,105],[65,55],[66,107],[67,109],[70,63],[78,95],[78,191],[80,81],[81,82],[82,13],[84,17],[87,14],[88,178],[91,181],[93,234],[95,88],[103,67],[105,66],[109,10],[127,162],[132,93],[136,172],[144,145],[145,153],[146,91],[148,176],[149,150],[150,136],[152,148],[153,154],[154,155],[155,133],[157,173],[158,157],[159,158],[160,159],[161,160],[162,21],[163,144],[172,58],[173,133],[176,149],[178,87],[181,84],[185,40],[191,80],[234,127],[246,161],[249,390],[251,389],[263,249],[263,466],[267,269],[269,270],[270,409],[276,283],[282,295],[283,282],[284,251],[288,397],[293,334],[295,285],[296,336],[297,332],[300,293],[310,415],[311,310],[312,311],[314,405],[317,402],[318,324],[321,375],[323,361],[324,308],[332,284],[334,296],[338,297],[356,454],[361,288],[365,379],[373,374],[374,380],[375,291],[377,152],[378,400],[379,378],[380,381],[381,382],[382,362],[384,398],[385,384],[386,385],[387,386],[388,387],[389,356],[390,373],[397,365],[398,362],[400,377],[402,318],[405,321],[409,291],[415,308],[454,323],[466,388]];
const FACE_IRIS_EDGES = [[469,470],[470,471],[471,472],[472,469],[474,475],[475,476],[476,477],[477,474]];
const HAND_CONNECTIONS = [[0,1],[0,5],[0,17],[1,2],[2,3],[3,4],[5,6],[5,9],[6,7],[7,8],[9,10],[9,13],[10,11],[11,12],[13,14],[13,17],[14,15],[15,16],[17,18],[18,19],[19,20]];

class PoseTrackerUI {
    constructor() {
        // Cấu hình ràng buộc nghiệp vụ (Business Rules)
        this.MAX_NOTIFICATIONS = 10;
        this.isPersonDetected = false;
        this.lastDetectionKey = '0-0-0';
        this.isWSConnected = false;
        this.isTracking = true; // Bật gửi frame ngay khi sẵn sàng

        // Cấu hình kết nối & hiệu năng
        this.WS_URL = `ws://${location.hostname || '127.0.0.1'}:8010/ws`;
        this.SEND_INTERVAL_MS = 100;   // ~10 FPS gửi lên backend
        this.CAPTURE_WIDTH = 640;      // Thu nhỏ frame để giảm băng thông
        this.JPEG_QUALITY = 0.6;

        // Trạng thái runtime
        this.ws = null;
        this.sendTimer = null;
        this.reconnectTimer = null;
        this.awaitingResponse = false; // Tránh dồn frame khi backend chậm
        this.currentPersons = [];
        this.currentFaces = [];
        this.currentHands = [];

        // Bảng màu neon phân biệt từng người khi có nhiều người trong khung hình
        this.PERSON_PALETTE = [
            { bone: '#00f0ff', joint: '#00ff66' }, // cyan / lime
            { bone: '#ff00e6', joint: '#ffd400' }, // magenta / vàng
            { bone: '#ff8a00', joint: '#ffffff' }, // cam / trắng
            { bone: '#7cff00', joint: '#00f0ff' }, // lime / cyan
        ];

        // Bảng màu riêng cho khuôn mặt (ngũ quan) - tách biệt hoà sắc để không lẫn với skeleton thân người
        this.FACE_PALETTE = [
            { contour: '#ffd166', iris: '#ef476f' }, // vàng đất / đỏ hồng
            { contour: '#06d6a0', iris: '#118ab2' }, // xanh ngọc / xanh dương
        ];

        // Bảng màu riêng cho bàn tay (khớp ngón tay)
        this.HAND_PALETTE = [
            { bone: '#ffffff', joint: '#00f0ff' },
            { bone: '#ffb86b', joint: '#ff00e6' },
            { bone: '#7cff00', joint: '#ffd400' },
            { bone: '#ef476f', joint: '#06d6a0' },
        ];

        // Bộ đếm FPS thực nhận
        this.frameCount = 0;
        this.fpsWindowStart = 0;
        this.currentFps = 0;

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

        // Canvas ẩn dùng để chụp & mã hoá frame gửi backend
        this.captureCanvas = document.createElement('canvas');
        this.captureCtx = this.captureCanvas.getContext('2d');

        // Nút điều khiển
        this.btnMockConnect = document.getElementById('btn-mock-connect');
        this.btnMockDetect = document.getElementById('btn-mock-detect');

        this.init();
    }

    init() {
        this.bindEvents();
        this.setupWebcam();
        this.handleResize();

        this.log('Hệ thống Core UI đã được khởi tạo thành công.', 'info');
        this.log('Đang chờ camera sẵn sàng để kết nối tới backend...', 'warning');
    }

    bindEvents() {
        window.addEventListener('resize', () => this.handleResize());

        // Nút 1: Kết nối lại WebSocket thủ công
        this.btnMockConnect.addEventListener('click', () => this.connectWebSocket());
        // Nút 2: Bật/tắt chế độ nhận diện (gửi frame)
        this.btnMockDetect.addEventListener('click', () => this.toggleTracking());
    }

    /**
     * Khởi tạo và xử lý luồng camera phần cứng
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
                this.placeholder.classList.add('hidden');
                this.log('Thiết bị Camera Mac đã được cấp quyền và kết nối mượt mà.', 'success');
                this.handleResize();

                // Camera đã sẵn sàng -> mở kết nối thật tới backend
                this.connectWebSocket();
            };
        } catch (error) {
            console.error("Lỗi đồng bộ camera:", error);
            this.placeholder.innerHTML = `<p style="color: #ff4a4a; font-weight: 600;">LỖI: Không thể truy cập Camera. Vui lòng cấp quyền trong System Preferences.</p>`;
            this.log('Truy cập camera thất bại: Quyền bị từ chối hoặc thiết bị bận.', 'error');
        }
    }

    /**
     * Đồng bộ độ phân giải Canvas overlay trùng khớp khung hình Video thực tế
     */
    handleResize() {
        const width = this.video.videoWidth || this.video.clientWidth;
        const height = this.video.videoHeight || this.video.clientHeight;

        this.canvas.width = width;
        this.canvas.height = height;
    }

    /**
     * Quản lý luồng thông báo hệ thống (tối đa 10 dòng, tự cuộn xuống dưới cùng)
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

        while (this.logContainer.children.length > this.MAX_NOTIFICATIONS) {
            this.logContainer.removeChild(this.logContainer.firstChild);
        }

        this.logContainer.scrollTop = this.logContainer.scrollHeight;
    }

    /**
     * Cập nhật badge trạng thái nhận diện (chỉ log khi có thay đổi trạng thái/số lượng để tránh spam)
     */
    setDetectionState(counts) {
        const { persons = 0, faces = 0, hands = 0 } = counts;
        const hasAny = persons > 0 || faces > 0 || hands > 0;
        const detectionKey = `${persons}-${faces}-${hands}`;
        const changed = detectionKey !== this.lastDetectionKey;
        this.isPersonDetected = hasAny;

        if (hasAny) {
            const parts = [];
            if (persons > 0) parts.push(persons === 1 ? '1 người' : `${persons} người`);
            if (faces > 0) parts.push(faces === 1 ? '1 khuôn mặt' : `${faces} khuôn mặt`);
            if (hands > 0) parts.push(hands === 1 ? '1 bàn tay' : `${hands} bàn tay`);

            this.detectionBadge.textContent = `Đang nhận diện: ${parts.join(', ')}`;
            this.detectionBadge.className = "badge badge-success";
            if (changed) {
                this.log(`MediaPipe: Phát hiện ${parts.join(', ')} trong vùng quét.`, 'success');
            }
        } else {
            this.detectionBadge.textContent = "Không nhận diện được người";
            this.detectionBadge.className = "badge badge-error";
            if (changed) {
                this.log('MediaPipe: Cảnh báo - Mất dấu thực thể hoặc khung hình trống.', 'warning');
            }
        }
        this.lastDetectionKey = detectionKey;
    }

    /**
     * Cập nhật trạng thái kết nối WebSocket trên UI
     */
    setConnectionState(connected) {
        this.isWSConnected = connected;
        if (connected) {
            this.statusDot.className = "status-dot connected";
            this.statusText.textContent = "ĐÃ KẾT NỐI (WS)";
        } else {
            this.statusDot.className = "status-dot disconnected";
            this.statusText.textContent = "MẤT KẾT NỐI (WS)";
        }
    }

    /**
     * Mở kết nối WebSocket thật tới backend
     */
    connectWebSocket() {
        // Dọn dẹp kết nối cũ nếu có
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
        if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
            this.ws.close();
        }

        this.log(`Đang mở kết nối tới ${this.WS_URL} ...`, 'info');

        try {
            this.ws = new WebSocket(this.WS_URL);
        } catch (e) {
            this.log(`Không thể tạo WebSocket: ${e.message}`, 'error');
            this.scheduleReconnect();
            return;
        }

        this.ws.onopen = () => {
            this.setConnectionState(true);
            this.awaitingResponse = false;
            this.log('Kênh WebSocket thời gian thực đã MỞ. Bắt đầu truyền frame.', 'success');
            this.startSendingFrames();
        };

        this.ws.onmessage = (event) => this.handleBackendMessage(event);

        this.ws.onclose = () => {
            this.setConnectionState(false);
            this.stopSendingFrames();
            this.clearCanvas();
            this.setDetectionState({ persons: 0, faces: 0, hands: 0 });
            this.log('Kênh WebSocket đã ĐÓNG. Sẽ thử kết nối lại sau 3s.', 'error');
            this.scheduleReconnect();
        };

        this.ws.onerror = () => {
            // onerror thường đi kèm onclose; chỉ ghi log gọn
            this.log('Lỗi đường truyền WebSocket (backend có đang chạy ở cổng 8010?).', 'error');
        };
    }

    scheduleReconnect() {
        if (this.reconnectTimer) return;
        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null;
            this.connectWebSocket();
        }, 3000);
    }

    /**
     * Bật/tắt chế độ nhận diện (điều khiển việc gửi frame)
     */
    toggleTracking() {
        this.isTracking = !this.isTracking;
        if (this.isTracking) {
            this.btnMockDetect.textContent = "Tắt nhận diện";
            this.log('Đã BẬT chế độ nhận diện chuyển động.', 'success');
            if (this.isWSConnected) this.startSendingFrames();
        } else {
            this.btnMockDetect.textContent = "Bật nhận diện";
            this.log('Đã TẮT chế độ nhận diện chuyển động.', 'warning');
            this.stopSendingFrames();
            this.clearCanvas();
            this.setDetectionState({ persons: 0, faces: 0, hands: 0 });
        }
    }

    /**
     * Vòng gửi frame định kỳ lên backend
     */
    startSendingFrames() {
        this.stopSendingFrames();
        if (!this.isTracking) return;
        this.fpsWindowStart = performance.now();
        this.frameCount = 0;
        this.sendTimer = setInterval(() => this.captureAndSendFrame(), this.SEND_INTERVAL_MS);
    }

    stopSendingFrames() {
        if (this.sendTimer) {
            clearInterval(this.sendTimer);
            this.sendTimer = null;
        }
    }

    /**
     * Chụp 1 khung hình từ video, mã hoá base64 JPEG và gửi lên backend
     */
    captureAndSendFrame() {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
        if (this.awaitingResponse) return; // Chờ backend xử lý xong frame trước
        if (!this.video.videoWidth) return;

        // Scale frame về CAPTURE_WIDTH giữ nguyên tỉ lệ
        const vw = this.video.videoWidth;
        const vh = this.video.videoHeight;
        const scale = this.CAPTURE_WIDTH / vw;
        const cw = this.CAPTURE_WIDTH;
        const ch = Math.round(vh * scale);

        if (this.captureCanvas.width !== cw || this.captureCanvas.height !== ch) {
            this.captureCanvas.width = cw;
            this.captureCanvas.height = ch;
        }

        // Vẽ frame gốc (KHÔNG lật) để MediaPipe nhận diện đúng chiều thật
        this.captureCtx.drawImage(this.video, 0, 0, cw, ch);
        const dataUrl = this.captureCanvas.toDataURL('image/jpeg', this.JPEG_QUALITY);

        try {
            this.ws.send(JSON.stringify({ image: dataUrl, timestamp: Date.now() }));
            this.awaitingResponse = true;
        } catch (e) {
            console.error('Gửi frame thất bại:', e);
        }
    }

    /**
     * Xử lý phản hồi từ backend: cập nhật badge, latency, FPS và vẽ skeleton thật
     */
    handleBackendMessage(event) {
        this.awaitingResponse = false;

        let data;
        try {
            data = JSON.parse(event.data);
        } catch (e) {
            return;
        }

        // Tính latency khứ hồi
        const latency = data.timestamp ? (Date.now() - data.timestamp) : 0;

        // Tính FPS thực trong cửa sổ 1 giây
        this.frameCount++;
        const elapsed = performance.now() - this.fpsWindowStart;
        if (elapsed >= 1000) {
            this.currentFps = Math.round((this.frameCount * 1000) / elapsed);
            this.frameCount = 0;
            this.fpsWindowStart = performance.now();
        }

        const persons = Array.isArray(data.persons) ? data.persons : [];
        const faces = Array.isArray(data.faces) ? data.faces : [];
        const hands = Array.isArray(data.hands) ? data.hands : [];

        if (data.success && (persons.length > 0 || faces.length > 0 || hands.length > 0)) {
            this.setDetectionState({ persons: persons.length, faces: faces.length, hands: hands.length });
            this.currentPersons = persons;
            this.currentFaces = faces;
            this.currentHands = hands;
            this.drawSkeleton(persons, faces, hands);
        } else {
            this.setDetectionState({ persons: 0, faces: 0, hands: 0 });
            this.currentPersons = [];
            this.currentFaces = [];
            this.currentHands = [];
            this.clearCanvas();
        }
        this.latencyBadge.textContent = `FPS: ${this.currentFps || '--'} | Latency: ${latency}ms`;
    }

    clearCanvas() {
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    }

    /**
     * Vẽ skeleton thật cho TẤT CẢ thực thể phát hiện được: thân người, khuôn mặt, bàn tay
     * (toạ độ chuẩn hoá 0..1 từ MediaPipe). Canvas overlay đã được CSS lật gương scaleX(-1)
     * trùng với video nên vẽ theo toạ độ gốc là khớp.
     */
    drawSkeleton(persons, faces, hands) {
        const w = this.canvas.width;
        const h = this.canvas.height;
        this.ctx.clearRect(0, 0, w, h);

        persons.forEach((lm, index) => {
            const palette = this.PERSON_PALETTE[index % this.PERSON_PALETTE.length];
            this.drawSinglePersonSkeleton(lm, palette);
        });

        faces.forEach((faceLm, index) => {
            const palette = this.FACE_PALETTE[index % this.FACE_PALETTE.length];
            this.drawSingleFace(faceLm, palette);
        });

        hands.forEach((hand, index) => {
            const palette = this.HAND_PALETTE[index % this.HAND_PALETTE.length];
            this.drawSingleHand(hand, palette);
        });
    }

    /**
     * Vẽ full body (đầu, thân, tay, hông, chân, bàn chân) cho 1 người với màu riêng biệt.
     * Backend trả về các khớp: head, {left,right}_{shoulder,elbow,wrist,hip,knee,ankle,foot_index}.
     */
    drawSinglePersonSkeleton(lm, palette) {
        const w = this.canvas.width;
        const h = this.canvas.height;

        const MIN_VIS = 0.3;
        const P = (key) => {
            const p = lm[key];
            if (!p || p.visibility < MIN_VIS) return null;
            return { x: p.x * w, y: p.y * h };
        };

        const head = P('head');
        const shL = P('left_shoulder');
        const shR = P('right_shoulder');
        const elL = P('left_elbow');
        const elR = P('right_elbow');
        const wrL = P('left_wrist');
        const wrR = P('right_wrist');
        const hipL = P('left_hip');
        const hipR = P('right_hip');
        const kneeL = P('left_knee');
        const kneeR = P('right_knee');
        const ankleL = P('left_ankle');
        const ankleR = P('right_ankle');
        const footL = P('left_foot_index');
        const footR = P('right_foot_index');

        // Điểm cổ = trung điểm hai vai; điểm giữa hông = trung điểm hai hông (dùng làm cột sống)
        const neck = (shL && shR) ? { x: (shL.x + shR.x) / 2, y: (shL.y + shR.y) / 2 } : null;
        const midHip = (hipL && hipR) ? { x: (hipL.x + hipR.x) / 2, y: (hipL.y + hipR.y) / 2 } : null;

        const bones = [
            // Đầu & vai
            [neck, head],
            [shL, shR],
            // Hai tay
            [shL, elL], [elL, wrL],
            [shR, elR], [elR, wrR],
            // Cột sống & khung hông
            [neck, midHip],
            [hipL, hipR],
            [shL, hipL], [shR, hipR],
            // Hai chân
            [hipL, kneeL], [kneeL, ankleL],
            [hipR, kneeR], [kneeR, ankleR],
            // Bàn chân
            [ankleL, footL], [ankleR, footR],
        ];

        // Vẽ xương với hiệu ứng neon
        this.ctx.strokeStyle = palette.bone;
        this.ctx.lineWidth = 4;
        this.ctx.lineCap = 'round';
        this.ctx.lineJoin = 'round';
        this.ctx.shadowBlur = 8;
        this.ctx.shadowColor = palette.bone;

        bones.forEach(([from, to]) => {
            if (!from || !to) return;
            this.ctx.beginPath();
            this.ctx.moveTo(from.x, from.y);
            this.ctx.lineTo(to.x, to.y);
            this.ctx.stroke();
        });

        // Vẽ các khớp
        this.ctx.fillStyle = palette.joint;
        this.ctx.shadowBlur = 10;
        this.ctx.shadowColor = palette.joint;

        [head, neck, shL, shR, elL, elR, wrL, wrR, midHip, hipL, hipR, kneeL, kneeR, ankleL, ankleR, footL, footR]
            .forEach(joint => {
                if (!joint) return;
                this.ctx.beginPath();
                this.ctx.arc(joint.x, joint.y, 5, 0, Math.PI * 2);
                this.ctx.fill();
            });

        this.ctx.shadowBlur = 0;
    }

    /**
     * Vẽ đầy đủ ngũ quan khuôn mặt: viền mắt, chân mày, mũi, viền môi, viền mặt (contours)
     * và mống mắt (iris). Backend gửi dict {"<mediapipe_index>": {x,y}} chỉ chứa tập con điểm cần thiết.
     */
    drawSingleFace(faceLm, palette) {
        const w = this.canvas.width;
        const h = this.canvas.height;

        const pt = (idx) => {
            const p = faceLm[String(idx)];
            return p ? { x: p.x * w, y: p.y * h } : null;
        };

        const drawEdges = (edges, color, width) => {
            this.ctx.strokeStyle = color;
            this.ctx.lineWidth = width;
            this.ctx.lineCap = 'round';
            this.ctx.shadowBlur = 4;
            this.ctx.shadowColor = color;
            edges.forEach(([a, b]) => {
                const from = pt(a);
                const to = pt(b);
                if (!from || !to) return;
                this.ctx.beginPath();
                this.ctx.moveTo(from.x, from.y);
                this.ctx.lineTo(to.x, to.y);
                this.ctx.stroke();
            });
        };

        // Ngũ quan: mắt, chân mày, mũi, môi, viền mặt
        drawEdges(FACE_CONTOUR_EDGES, palette.contour, 1.5);
        // Mống mắt
        drawEdges(FACE_IRIS_EDGES, palette.iris, 1.5);

        this.ctx.shadowBlur = 0;
    }

    /**
     * Vẽ đầy đủ 21 khớp ngón tay của 1 bàn tay theo topology chuẩn HAND_CONNECTIONS.
     * Backend gửi mảng landmarks theo đúng thứ tự chỉ số MediaPipe (0..20).
     */
    drawSingleHand(hand, palette) {
        const w = this.canvas.width;
        const h = this.canvas.height;
        const points = (hand.landmarks || []).map(p => ({ x: p.x * w, y: p.y * h }));
        if (points.length < 21) return;

        this.ctx.strokeStyle = palette.bone;
        this.ctx.lineWidth = 3;
        this.ctx.lineCap = 'round';
        this.ctx.lineJoin = 'round';
        this.ctx.shadowBlur = 6;
        this.ctx.shadowColor = palette.bone;

        HAND_CONNECTIONS.forEach(([a, b]) => {
            this.ctx.beginPath();
            this.ctx.moveTo(points[a].x, points[a].y);
            this.ctx.lineTo(points[b].x, points[b].y);
            this.ctx.stroke();
        });

        this.ctx.fillStyle = palette.joint;
        this.ctx.shadowBlur = 6;
        this.ctx.shadowColor = palette.joint;
        points.forEach(p => {
            this.ctx.beginPath();
            this.ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
            this.ctx.fill();
        });

        this.ctx.shadowBlur = 0;
    }
}

// Khởi chạy khi DOM sẵn sàng
document.addEventListener('DOMContentLoaded', () => {
    window.trackerApp = new PoseTrackerUI();
});
