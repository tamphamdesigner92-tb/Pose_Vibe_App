import cv2
import numpy as np
import mediapipe as mp
import base64
import os
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor

from mediapipe.tasks.python import vision
from mediapipe.tasks.python.core.base_options import BaseOptions
from mediapipe.tasks.python.vision.core.vision_task_running_mode import VisionTaskRunningMode

MODEL_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "models")

# Model bundle chính thống của Google cho từng tác vụ (Tasks API - hỗ trợ đa thực thể)
POSE_MODEL_URL = "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task"
FACE_MODEL_URL = "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task"
HAND_MODEL_URL = "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task"

POSE_MODEL_PATH = os.path.join(MODEL_DIR, "pose_landmarker_lite.task")
FACE_MODEL_PATH = os.path.join(MODEL_DIR, "face_landmarker.task")
HAND_MODEL_PATH = os.path.join(MODEL_DIR, "hand_landmarker.task")

# Số lượng thực thể tối đa nhận diện đồng thời mỗi khung hình (giới hạn để giữ độ trễ thấp)
MAX_PERSONS = 4   # Pose (model "lite" - chi phí thấp)
MAX_FACES = 2     # Face Mesh (model nặng hơn - giới hạn chặt để tối ưu tốc độ)
MAX_HANDS = 4     # Hand (tối đa 2 người x 2 tay)

# Ánh xạ tên khớp sang chỉ số landmark BlazePose Pose (0-32) - bao gồm thân dưới và bàn chân
CORE_JOINTS = {
    "head": 0,
    "left_shoulder": 11, "right_shoulder": 12,
    "left_elbow": 13, "right_elbow": 14,
    "left_wrist": 15, "right_wrist": 16,
    "left_hip": 23, "right_hip": 24,
    "left_knee": 25, "right_knee": 26,
    "left_ankle": 27, "right_ankle": 28,
    "left_foot_index": 31, "right_foot_index": 32,
}

# Tập con chỉ số landmark khuôn mặt (trong tổng số 478 điểm) đủ để vẽ đầy đủ ngũ quan:
# viền mắt, chân mày, mũi, viền môi, viền mặt (FACEMESH_CONTOURS) + mống mắt (FACEMESH_IRISES).
# Chỉ gửi tập con này (thay vì cả 478 điểm) để giảm băng thông truyền tải và chi phí vẽ mỗi khung hình.
FACE_CONTOUR_INDICES = sorted({i for pair in mp.solutions.face_mesh.FACEMESH_CONTOURS for i in pair})
FACE_IRIS_INDICES = sorted({i for pair in mp.solutions.face_mesh.FACEMESH_IRISES for i in pair})
FACE_LANDMARK_INDICES = sorted(set(FACE_CONTOUR_INDICES) | set(FACE_IRIS_INDICES))


def _ensure_model_downloaded(url: str, path: str):
    """Tải model bundle Tasks API về máy nếu chưa có sẵn (chỉ cần tải 1 lần, sau đó dùng cache)."""
    if os.path.exists(path):
        return
    os.makedirs(os.path.dirname(path), exist_ok=True)
    try:
        urllib.request.urlretrieve(url, path)
    except Exception as e:
        raise RuntimeError(
            f"Không thể tải model '{os.path.basename(path)}' "
            f"(cần kết nối Internet ở lần chạy đầu tiên): {e}"
        )


def _create_landmarker(label: str, model_cls, options_cls, model_path: str, **extra_kwargs):
    """
    Khởi tạo landmarker với GPU delegate (Metal) để tối ưu tốc độ; nếu máy không hỗ trợ
    (ví dụ Mac Intel không có Metal phù hợp) thì tự động rơi về CPU delegate an toàn.
    Lưu ý: bước rơi về CPU chỉ xử lý lỗi ở thời điểm KHỞI TẠO. Rủi ro crash khi ĐANG suy luận
    do sai định dạng ảnh (SRGB thay vì SRGBA) được loại trừ triệt để bằng cách toàn bộ
    pipeline luôn dùng ảnh RGBA (xem process_frame), áp dụng cho cả CPU lẫn GPU delegate.
    """
    try:
        options = options_cls(
            base_options=BaseOptions(model_asset_path=model_path, delegate=BaseOptions.Delegate.GPU),
            running_mode=VisionTaskRunningMode.VIDEO,
            **extra_kwargs,
        )
        landmarker = model_cls.create_from_options(options)
        print(f"✅ [{label}] Khởi tạo thành công với GPU delegate (Metal).")
        return landmarker
    except Exception as e:
        print(f"⚠️ [{label}] Không thể dùng GPU delegate ({e}). Chuyển sang CPU delegate.")
        options = options_cls(
            base_options=BaseOptions(model_asset_path=model_path, delegate=BaseOptions.Delegate.CPU),
            running_mode=VisionTaskRunningMode.VIDEO,
            **extra_kwargs,
        )
        return model_cls.create_from_options(options)


class PoseTracker:
    def __init__(self):
        _ensure_model_downloaded(POSE_MODEL_URL, POSE_MODEL_PATH)
        _ensure_model_downloaded(FACE_MODEL_URL, FACE_MODEL_PATH)
        _ensure_model_downloaded(HAND_MODEL_URL, HAND_MODEL_PATH)

        self.pose_landmarker = _create_landmarker(
            "Pose", vision.PoseLandmarker, vision.PoseLandmarkerOptions, POSE_MODEL_PATH,
            num_poses=MAX_PERSONS,
            min_pose_detection_confidence=0.5,
            min_pose_presence_confidence=0.5,
            min_tracking_confidence=0.5,
        )
        self.face_landmarker = _create_landmarker(
            "Face", vision.FaceLandmarker, vision.FaceLandmarkerOptions, FACE_MODEL_PATH,
            num_faces=MAX_FACES,
            min_face_detection_confidence=0.5,
            min_face_presence_confidence=0.5,
            min_tracking_confidence=0.5,
        )
        self.hand_landmarker = _create_landmarker(
            "Hand", vision.HandLandmarker, vision.HandLandmarkerOptions, HAND_MODEL_PATH,
            num_hands=MAX_HANDS,
            min_hand_detection_confidence=0.5,
            min_hand_presence_confidence=0.5,
            min_tracking_confidence=0.5,
        )

        # Chạy 3 model song song trên nhiều luồng (MediaPipe giải phóng GIL khi suy luận)
        # để giảm tổng độ trễ mỗi khung hình so với chạy tuần tự.
        self._executor = ThreadPoolExecutor(max_workers=3, thread_name_prefix="mp-infer")

        # Dùng cho việc tạo timestamp tăng dần đơn điệu bắt buộc bởi chế độ VIDEO
        self._start_time = None
        self._last_timestamp_ms = -1

    def base64_to_ndarray(self, base64_string: str) -> np.ndarray:
        """Giải mã chuỗi Base64 từ Frontend thành ma trận hình ảnh OpenCV."""
        if "," in base64_string:
            base64_string = base64_string.split(",")[1]

        img_bytes = base64.b64decode(base64_string)
        np_arr = np.frombuffer(img_bytes, np.uint8)
        return cv2.imdecode(np_arr, cv2.IMREAD_COLOR)

    def _next_timestamp_ms(self) -> int:
        """Sinh timestamp mili-giây tăng dần đơn điệu dựa trên thời gian thực."""
        now = time.monotonic()
        if self._start_time is None:
            self._start_time = now
        elapsed_ms = int((now - self._start_time) * 1000)
        if elapsed_ms <= self._last_timestamp_ms:
            elapsed_ms = self._last_timestamp_ms + 1
        self._last_timestamp_ms = elapsed_ms
        return elapsed_ms

    def _extract_persons(self, pose_result) -> list:
        """Trích xuất khớp thân người (đầu, thân, tay, chân) cho từng người phát hiện được."""
        persons = []
        for person_landmarks in pose_result.pose_landmarks:
            serialized_joints = {
                name: {
                    "x": person_landmarks[idx].x,
                    "y": person_landmarks[idx].y,
                    "visibility": person_landmarks[idx].visibility,
                }
                for name, idx in CORE_JOINTS.items()
            }
            persons.append(serialized_joints)
        return persons

    def _extract_faces(self, face_result) -> list:
        """Trích xuất tập con landmark khuôn mặt (ngũ quan + mống mắt) cho từng khuôn mặt phát hiện được."""
        faces = []
        for face_landmarks in face_result.face_landmarks:
            serialized_points = {
                str(idx): {"x": face_landmarks[idx].x, "y": face_landmarks[idx].y}
                for idx in FACE_LANDMARK_INDICES
            }
            faces.append(serialized_points)
        return faces

    def _extract_hands(self, hand_result) -> list:
        """Trích xuất đầy đủ 21 khớp ngón tay cho từng bàn tay phát hiện được."""
        hands = []
        for i, hand_landmarks in enumerate(hand_result.hand_landmarks):
            handedness = ""
            if hand_result.handedness and i < len(hand_result.handedness):
                handedness = hand_result.handedness[i][0].category_name

            hands.append({
                "handedness": handedness,
                "landmarks": [{"x": lm.x, "y": lm.y} for lm in hand_landmarks],
            })
        return hands

    def process_frame(self, base64_frame: str):
        """
        Phân tích khung hình và trích xuất Pose (đa người) + Face Mesh (đa khuôn mặt) +
        Hand (đa bàn tay) SONG SONG để tối ưu độ trễ.
        Trả về: (is_detected, payload, status_message)
        payload = {"persons": [...], "faces": [...], "hands": [...]}
        """
        try:
            image = self.base64_to_ndarray(base64_frame)
            if image is None:
                return False, {"persons": [], "faces": [], "hands": []}, "Lỗi: Không thể giải mã dữ liệu hình ảnh thô."

            # Chuyển đổi BGR (OpenCV) sang RGBA - dùng chung 1 ảnh cho cả 3 model.
            # BẮT BUỘC dùng RGBA (4 kênh) khi chạy GPU delegate (Metal): đưa ảnh RGB (3 kênh)
            # vào GPU delegate gây crash cứng ở tầng C++ (không bắt được bằng try/except).
            # RGBA cũng hoạt động bình thường với CPU delegate nên dùng thống nhất cho cả 2.
            image_rgba = cv2.cvtColor(image, cv2.COLOR_BGR2RGBA)
            mp_image = mp.Image(image_format=mp.ImageFormat.SRGBA, data=image_rgba)

            timestamp_ms = self._next_timestamp_ms()

            # Đưa cả 3 tác vụ suy luận vào luồng riêng, chạy đồng thời thay vì tuần tự
            future_pose = self._executor.submit(self.pose_landmarker.detect_for_video, mp_image, timestamp_ms)
            future_face = self._executor.submit(self.face_landmarker.detect_for_video, mp_image, timestamp_ms)
            future_hand = self._executor.submit(self.hand_landmarker.detect_for_video, mp_image, timestamp_ms)

            pose_result = future_pose.result()
            face_result = future_face.result()
            hand_result = future_hand.result()

            persons = self._extract_persons(pose_result)
            faces = self._extract_faces(face_result)
            hands = self._extract_hands(hand_result)

            is_detected = bool(persons or faces or hands)
            payload = {"persons": persons, "faces": faces, "hands": hands}

            if is_detected:
                message = (
                    f"MediaPipe: Nhận diện {len(persons)} người / "
                    f"{len(faces)} khuôn mặt / {len(hands)} bàn tay."
                )
            else:
                message = "MediaPipe: Cảnh báo - Không tìm thấy thực thể nào trong khung hình."

            return is_detected, payload, message

        except Exception as e:
            return False, {"persons": [], "faces": [], "hands": []}, f"Lỗi xử lý hệ thống bên trong: {str(e)}"
