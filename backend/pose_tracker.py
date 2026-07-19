import cv2
import numpy as np
import mediapipe as mp
import base64
import os
import time
import urllib.request

from mediapipe.tasks.python import vision
from mediapipe.tasks.python.core.base_options import BaseOptions
from mediapipe.tasks.python.vision.core.vision_task_running_mode import VisionTaskRunningMode

# Model bundle chính thống của Google cho MediaPipe Tasks (hỗ trợ đa người - num_poses)
MODEL_URL = "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task"
MODEL_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "models")
MODEL_PATH = os.path.join(MODEL_DIR, "pose_landmarker_lite.task")

# Số người tối đa được nhận diện đồng thời trong một khung hình
MAX_PERSONS = 4

# Ánh xạ tên khớp sang chỉ số landmark BlazePose (0-32) - bao gồm cả thân dưới và bàn chân
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


def _ensure_model_downloaded():
    """Tải model bundle Tasks API về máy nếu chưa có sẵn (chỉ cần tải 1 lần)."""
    if os.path.exists(MODEL_PATH):
        return
    os.makedirs(MODEL_DIR, exist_ok=True)
    try:
        urllib.request.urlretrieve(MODEL_URL, MODEL_PATH)
    except Exception as e:
        raise RuntimeError(
            f"Không thể tải model nhận diện tư thế (cần kết nối Internet ở lần chạy đầu tiên): {e}"
        )


class PoseTracker:
    def __init__(self):
        _ensure_model_downloaded()

        options = vision.PoseLandmarkerOptions(
            base_options=BaseOptions(model_asset_path=MODEL_PATH),
            running_mode=VisionTaskRunningMode.VIDEO,
            num_poses=MAX_PERSONS,
            min_pose_detection_confidence=0.5,
            min_pose_presence_confidence=0.5,
            min_tracking_confidence=0.5,
        )
        self.landmarker = vision.PoseLandmarker.create_from_options(options)

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

    def process_frame(self, base64_frame: str):
        """
        Phân tích khung hình và trích xuất các khớp xương quan trọng cho TẤT CẢ người tìm thấy.
        Trả về: (is_detected, persons_list, status_message)
        persons_list: danh sách các dict landmarks, mỗi phần tử tương ứng với 1 người.
        """
        try:
            image = self.base64_to_ndarray(base64_frame)
            if image is None:
                return False, [], "Lỗi: Không thể giải mã dữ liệu hình ảnh thô."

            # Chuyển đổi BGR (OpenCV) sang RGB (MediaPipe)
            image_rgb = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
            mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=image_rgb)

            timestamp_ms = self._next_timestamp_ms()
            result = self.landmarker.detect_for_video(mp_image, timestamp_ms)

            if not result.pose_landmarks:
                return False, [], "MediaPipe: Cảnh báo - Không tìm thấy thực thể người."

            # Trích xuất các khớp cốt lõi (đầu, thân, tay, chân) cho từng người phát hiện được
            persons = []
            for person_landmarks in result.pose_landmarks:
                serialized_joints = {
                    name: {
                        "x": person_landmarks[idx].x,
                        "y": person_landmarks[idx].y,
                        "visibility": person_landmarks[idx].visibility,
                    }
                    for name, idx in CORE_JOINTS.items()
                }
                persons.append(serialized_joints)

            message = f"MediaPipe: Nhận diện thành công {len(persons)} thực thể người."
            return True, persons, message

        except Exception as e:
            return False, [], f"Lỗi xử lý hệ thống bên trong: {str(e)}"
