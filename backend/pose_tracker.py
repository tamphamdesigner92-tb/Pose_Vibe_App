import cv2
import numpy as np
import mediapipe as mp  # Đưa về import chuẩn
import base64

class PoseTracker:
    def __init__(self):
        # Sử dụng đối tượng giải pháp chính thống
        self.mp_pose = mp.solutions.pose
        
        self.pose = self.mp_pose.Pose(
            static_image_mode=False,
            model_complexity=0, 
            smooth_landmarks=True,
            min_detection_confidence=0.5,
            min_tracking_confidence=0.5
        )

    def base64_to_ndarray(self, base64_string: str) -> np.ndarray:
        """Giải mã chuỗi Base64 từ Frontend thành ma trận hình ảnh OpenCV."""
        if "," in base64_string:
            base64_string = base64_string.split(",")[1]
        
        img_bytes = base64.b64decode(base64_string)
        np_arr = np.frombuffer(img_bytes, np.uint8)
        return cv2.imdecode(np_arr, cv2.IMREAD_COLOR)

    def process_frame(self, base64_frame: str):
        """
        Phân tích khung hình và trích xuất các khớp xương quan trọng.
        Trả về: (is_detected, landmarks_dict, status_message)
        """
        try:
            image = self.base64_to_ndarray(base64_frame)
            if image is None:
                return False, {}, "Lỗi: Không thể giải mã dữ liệu hình ảnh thô."

            # Chuyển đổi BGR (OpenCV) sang RGB (MediaPipe)
            image_rgb = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
            results = self.pose.process(image_rgb)

            if not results.pose_landmarks:
                return False, {}, "MediaPipe: Cảnh báo - Không tìm thấy thực thể người."

            # Chỉ lọc và trích xuất các khớp xương cốt lõi để vẽ stick figure nhằm tối ưu băng thông
            core_landmarks = {
                "head": results.pose_landmarks.landmark[self.mp_pose.PoseLandmark.NOSE],
                "left_shoulder": results.pose_landmarks.landmark[self.mp_pose.PoseLandmark.LEFT_SHOULDER],
                "right_shoulder": results.pose_landmarks.landmark[self.mp_pose.PoseLandmark.RIGHT_SHOULDER],
                "left_elbow": results.pose_landmarks.landmark[self.mp_pose.PoseLandmark.LEFT_ELBOW],
                "right_elbow": results.pose_landmarks.landmark[self.mp_pose.PoseLandmark.RIGHT_ELBOW],
                "left_wrist": results.pose_landmarks.landmark[self.mp_pose.PoseLandmark.LEFT_WRIST],
                "right_wrist": results.pose_landmarks.landmark[self.mp_pose.PoseLandmark.RIGHT_WRIST]
            }

            # Định dạng lại dữ liệu tọa độ tinh gọn (x, y, visibility)
            serialized_landmarks = {
                joint: {"x": lm.x, "y": lm.y, "visibility": lm.visibility}
                for joint, lm in core_landmarks.items()
            }

            return True, serialized_landmarks, "MediaPipe: Nhận diện tư thế thành công."

        except Exception as e:
            return False, {}, f"Lỗi xử lý hệ thống bên trong: {str(e)}"