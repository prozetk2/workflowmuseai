# Hướng dẫn test cos_alpha_flow 1.6.2

Tài liệu cho tester. Phần A là test bằng tay trên Chrome thật, phần B là chạy bộ test tự động (trang giả, không tốn credit).

## A. Test bằng tay

### 1. Cài bản cần test

1. Tải repo về: nút **Code → Download ZIP** trên GitHub rồi giải nén, hoặc `git clone https://github.com/prozetk2/workflowmuseai.git`.
2. Mở `chrome://extensions`, bật **Developer mode** (góc phải trên).
3. Bấm **Load unpacked**, chọn thư mục `cos-alpha-flow` (thư mục có `manifest.json`).
4. Kiểm tra thẻ extension ghi **1.6.2**. Nếu máy còn TheKey.studio Flow hoặc bản cos_alpha_flow cũ, tắt bản đó đi.
5. Mỗi lần kéo code mới về (`git pull`), quay lại `chrome://extensions` và bấm nút tải lại (mũi tên vòng) trên thẻ cos_alpha_flow, rồi tải lại tab Flow.

### 2. Chuẩn bị

- Mở Google Flow (https://flow.google.com), đăng nhập, mở một project và để tab đó mở.
- Bấm biểu tượng cos_alpha_flow trên thanh Chrome: **bảng bên** mở cạnh tab Flow.
- Muốn test chế độ API: **Cài đặt → Tạo bằng → Gemini API**, dán API key của bạn. Lưu ý API tính tiền thật.

### 3. Danh sách kiểm tra

Đánh dấu từng mục, mục nào lỗi thì ghi lại theo phần 4.

**Bảng bên**
- [ ] Bảng bên có các tab Tạo, **Workflow**, Hàng đợi, Album, Prompt, Nhân vật, Lịch sử.
- [ ] Bấm tab **Workflow**: mở canvas toàn màn hình trong tab mới, bảng bên tự đóng.
- [ ] Tab Tạo: gõ 2 prompt, tạo ảnh qua tab Flow; ảnh về Album.

**Canvas (thẻ node kiểu mới)**
- [ ] Mỗi node có icon loại, số thứ tự chạy, nhãn nguồn ("Google Flow" / "Gemini API"), khung xem trước.
- [ ] Model, vai trò ảnh nằm trong mục **Tuỳ chọn thêm**; mở ra rồi vẫn giữ mở khi canvas vẽ lại.
- [ ] Thanh công cụ bên trái có 7 nút: Thêm node, Kho mẫu, Ghi chú, Chạy tất cả, Hoàn tác, Tự sắp xếp, Vừa khít.
- [ ] Phím **N** hoặc nháy đúp chỗ trống mở hộp tìm node; gõ không dấu ("anh dau vao") vẫn ra; Enter thêm node, Esc đóng.
- [ ] Rê chuột lên node hiện thanh nổi: Chạy, Phóng to, Nhân bản, Xoá.

**Kéo dây ra chỗ trống**
- [ ] Kéo dây từ cổng ra "ảnh" của node Tạo ảnh rồi thả vào chỗ trống: hiện hộp chọn chỉ gồm node nhận được ảnh (có Tạo video, Xem trước; không có Câu lệnh).
- [ ] Chọn "Tạo video": node mới xuất hiện và tự nối vào cổng ảnh tham chiếu.
- [ ] Kéo ngược từ cổng vào "ảnh tham chiếu" ra chỗ trống: hộp chỉ có node cho ra ảnh; chọn "Ảnh đầu vào" thì node mới nằm bên trái và tự nối.
- [ ] Nhóm "Nối vào node có sẵn" nối đúng vào node đang có trên canvas.
- [ ] Esc đóng hộp, không để lại dây dở.

**Bật/tắt node và phóng to thẻ**
- [ ] Gạt công tắc trên đầu node: thẻ mờ đi, hiện "Đã tắt · bỏ qua khi Chạy tất cả", mất số thứ tự.
- [ ] Bấm **Chạy tất cả**: node đã tắt không chạy, không báo lỗi. Ctrl+Z bật lại được.
- [ ] Nút phóng to trên thanh nổi đổi thẻ 1x → 1.5x → 2x → 1x.

**Kho mẫu (10 mẫu)**
- [ ] Mở Kho mẫu từ thanh trái: có 10 mẫu, lọc theo nhóm và tìm kiếm được.
- [ ] Dùng từng mẫu: node không chồng lên nhau, vừa màn hình, dây nối đủ. Ctrl+Z bỏ mẫu vừa thêm.
- [ ] Mẫu **Idol lên thảm đỏ**: 2 ảnh đầu vào (gương mặt, trang phục) → ảnh character sheet 16:9 → video thảm đỏ. Thử chạy thật với ảnh của bạn.
- [ ] Dồn các node chồng lên nhau rồi bấm **Tự sắp xếp**: node xếp trái sang phải theo thứ tự chạy, không chồng nhau.

**Prompt Assistant và viết kịch bản**
- [ ] Prompt Assistant với ChatGPT web và Gemini web: ra prompt, màn hình kết quả hiện đúng.
- [ ] Sau khi xong, chỉ cuộc chat do app tạo bị xoá; chat cũ của bạn không bị đụng tới.
- [ ] Viết kịch bản bằng AI rồi tạo node từng cảnh.

**Tạo thật trên Google Flow (tốn credit, làm ít lượt)**
- [ ] Một ảnh từ prompt.
- [ ] Một video có 1–3 ảnh tham chiếu (Ingredients).
- [ ] Một video khung đầu (Frames).
- [ ] Hàng đợi: tạm dừng, bỏ qua, chạy lại mục lỗi.
- [ ] Timeline: ghép 2 clip, xuất MP4.
- [ ] Nếu Google báo "hoạt động bất thường", app phải dừng cả lượt chạy ngay. App không có và sẽ không có cách vượt kiểm tra này; dùng chế độ Gemini API nếu cần.

### 4. Báo lỗi

Mỗi lỗi gửi kèm:
1. Phiên bản (ghi trên thẻ extension, ví dụ 1.6.2) và chế độ tạo (tab Flow hay Gemini API).
2. Các bước làm để ra lỗi, kết quả mong đợi, kết quả thực tế.
3. Ảnh chụp màn hình (cả canvas lẫn tab Flow nếu liên quan).
4. Log lỗi: trên trang canvas bấm **F12 → Console**, chụp các dòng đỏ. Lỗi của phần nền thì vào `chrome://extensions` → thẻ cos_alpha_flow → **Service worker** → Console.
5. Nếu lỗi nằm trong một workflow, xuất workflow ra file JSON gửi kèm. File xuất không chứa API key.

Không gửi API key, mật khẩu hay cookie trong báo lỗi.

## B. Test tự động

Bộ test chạy extension trong Chromium không giao diện, với trang Flow / ChatGPT / Gemini / Muse **giả** nên không cần đăng nhập và không tốn credit. Nó kiểm tra logic của app, không thay được việc test trên Flow thật.

Cần Node.js 18 trở lên.

```bash
cd cos-alpha-flow-tests
npm install
npx playwright install chromium
npm test                      # chạy t1..t15 với ../cos-alpha-flow
node run-all.js t14 t15       # chỉ chạy vài test
node run-all.js D:\duong\dan\ban-khac t15   # test một bản extension khác
```

Trên Linux/macOS có thể dùng `./run-all.sh` thay cho `npm test`.

Mỗi test (t4–t15) in `PASS` / `FAIL` từng mục và ghi toàn bộ ra `out-tN.txt`. Kết quả mong đợi ở bản 1.6.2: tất cả đều qua.

| Test | Kiểm tra |
| --- | --- |
| t1–t3 | Chạy thử tổng quát: canvas, hàng đợi, overlay trên tab Flow, Album, bảng bên. Ba test này in số liệu thay vì PASS/FAIL; đạt khi dòng cuối là `ERRORS: none` |
| t4 | Tạo qua tab Flow (giao diện agent): ảnh, video tham chiếu và khung đầu, phê duyệt, Album, dừng khi bị chặn |
| t5 | Chế độ Gemini API: kịch bản → cảnh, Khoá nhân vật, Veo, khung cuối |
| t6 | Chuột phải vào ảnh trên web → đọc ảnh |
| t7 | Tạo nhanh ở bảng bên qua tab Flow |
| t8 | Tự mở Flow, viết kịch bản qua ChatGPT / Gemini web |
| t9 | Prompt Assistant với Gemini API, SRT → prompt |
| t10 | Flow giao diện cũ (tắt Agent): chọn loại, tỉ lệ, thời lượng, model |
| t11 | Tạo qua ChatGPT / Grok / Gemini web và Muse |
| t12–t13 | Prompt Assistant với ChatGPT web: trả lời chậm, nhận biết xong, dọn chat |
| t14 | Canvas 1.6: thẻ node, hộp tìm node, Kho mẫu 10 mẫu, tự sắp xếp |
| t15 | Bật/tắt node, phóng to thẻ, kéo dây ra chỗ trống |
