# TheKey.studio Flow

Bản TheKey.studio dùng **Google Flow (Veo)** thay cho muse.ai. Giữ nguyên canvas node, Script → Nodes, Timeline và xuất MP4 bằng FFmpeg ngay trên máy; chỉ đổi phần tạo ảnh/video.

## Cài đặt

1. Mở `chrome://extensions`, bật **Developer mode**.
2. Bấm **Load unpacked**, chọn thư mục này (thư mục có `manifest.json`).
3. Bấm biểu tượng TheKey.studio Flow để mở canvas.

Nếu bạn đã cài TheKey.studio (bản muse.ai), hai bản chạy song song được: dữ liệu của mỗi bản nằm riêng.

## Hai cách tạo

| | Tab Google Flow (mặc định) | Gemini API |
| --- | --- | --- |
| Chuẩn bị | Mở flow.google.com, đăng nhập, mở một project, để tab đó mở | Settings → Generate with → Gemini API, dán API key |
| Chi phí | Credit trong gói Google AI | Tính tiền theo giây video trên tài khoản API |
| Độ bền | Phụ thuộc giao diện Flow | Dùng API chính thức |

## Khác bản muse.ai ở đâu

- Video: chỉ 16:9 hoặc 9:16, dài 4, 6 hoặc 8 giây. Tạo ảnh trên Flow nhận tối đa 5 ảnh; tạo video nhận tối đa 3 ảnh tham chiếu (qua Gemini API thì clip có ảnh tham chiếu luôn dài 8 giây). Video dùng hoặc 1 khung đầu, hoặc các ảnh tham chiếu (Reference-to-Video), không dùng cả hai cùng lúc.
- Mỗi node Ảnh đầu vào có ô "Ảnh này là:" (người mẫu, trang phục, sản phẩm, bối cảnh, phong cách, khung đầu video). Mẫu "👗 Quảng cáo thời trang" ở cột trái dựng sẵn quy trình người mẫu + trang phục → ảnh 9:16 → video 8 giây.
- Node Generate Video có thêm ô **Model** và ô **Images → start frame / ingredients**.
- Continuity dùng khung cuối của clip trước làm **khung đầu** (Frames to Video), không còn là lời dặn trong prompt.
- Không tự gửi lại khi bị từ chối; sửa prompt rồi chạy lại node.
- **Settings → Check Flow page** cho biết những phần nào của trang Flow còn tìm thấy, để sửa nhanh khi Google đổi giao diện.

## Tệp chính

| Tệp | Vai trò |
| --- | --- |
| `flow-bridge.js` | Chạy trong tab Flow: chọn cài đặt, tải ảnh, gõ prompt, bấm tạo, chờ clip mới |
| `flow-page-hook.js` | Chạy trong trang Flow để nhận ô chọn file khi tải ảnh lên |
| `veo-api.js` | Gọi Veo và model ảnh qua Gemini API |
| `background.js` | Mở canvas; thao tác chuột/bàn phím "trusted" khi Flow không nhận sự kiện thường |
| `app.js`, `app.html` | Canvas, chạy workflow, Timeline, lưu trữ, xuất phim |

## Lưu ý

Tự động hoá giao diện Flow có thể trái điều khoản của Google, và mỗi lượt tạo đều trừ credit thật. Thử một cảnh trước khi chạy cả kịch bản. API key chỉ lưu trong trình duyệt này, không nằm trong file workflow xuất ra.

Giấy phép: GPL-2.0-or-later (đi kèm FFmpeg), xem `LICENSE` và `THIRD_PARTY_NOTICES.md`.
