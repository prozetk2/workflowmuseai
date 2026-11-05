# Hướng dẫn test cos_alpha_flow 1.10.0

Tài liệu cho tester. Phần A là test bằng tay trên Chrome thật, phần B là chạy bộ test tự động (trang giả, không tốn credit).

## A. Test bằng tay

### 1. Cài bản cần test

1. Tải repo về: nút **Code → Download ZIP** trên GitHub rồi giải nén, hoặc `git clone https://github.com/prozetk2/workflowmuseai.git`.
2. Mở `chrome://extensions`, bật **Developer mode** (góc phải trên).
3. Bấm **Load unpacked**, chọn thư mục `cos-alpha-flow` (thư mục có `manifest.json`).
4. Kiểm tra thẻ extension ghi **1.10.0**. Nếu máy còn TheKey.studio Flow hoặc bản cos_alpha_flow cũ, tắt bản đó đi.
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

**Kho mẫu (11 mẫu)**
- [ ] Mở Kho mẫu từ thanh trái: có 11 mẫu, lọc theo nhóm và tìm kiếm được.
- [ ] Dùng từng mẫu: node không chồng lên nhau, vừa màn hình, dây nối đủ. Ctrl+Z bỏ mẫu vừa thêm.
- [ ] Mẫu **Idol lên thảm đỏ**: 2 ảnh đầu vào (gương mặt, trang phục) → ảnh character sheet 16:9 → video thảm đỏ. Thử chạy thật với ảnh của bạn.
- [ ] Dồn các node chồng lên nhau rồi bấm **Tự sắp xếp**: node xếp trái sang phải theo thứ tự chạy, không chồng nhau.

**Ảnh nhiều góc (mới ở 1.7)**
- [ ] Thả ảnh người mẫu vào node Ảnh đầu vào vai trò "Người mẫu / nhân vật": app tự chèn node "Người mẫu nhiều góc" giữa ảnh và cảnh, không đè lên node khác.
- [ ] Thả ảnh trước, chọn vai trò "Trang phục" sau: app chèn node "Trang phục nhiều góc".
- [ ] Ctrl+Z ngay sau đó: node nhiều góc biến mất, ảnh nối thẳng lại vào cảnh.
- [ ] Bỏ tick "Tự tạo khi thả ảnh vào": thả ảnh không chèn gì; nút "Tạo ảnh nhiều góc" vẫn chèn được.
- [ ] Ô "Kiểu ảnh" trên node Tạo ảnh đổi qua lại giữa ảnh thường và 3 kiểu nhiều góc.
- [ ] Mẫu "Người mẫu mặc đồ · ảnh nhiều góc": chạy thật trên Flow với 1 ảnh người mẫu + 1 ảnh trang phục. Ghi lại: ảnh người mẫu nhiều góc có giữ đúng mặt không; ảnh trang phục nhiều góc có đúng đồ không; ảnh ghép có đúng người + đúng đồ không; video có giữ được mặt và đồ không (gửi kèm ảnh kết quả).

**Prompt Assistant và viết kịch bản**
- [ ] Prompt Assistant với ChatGPT web và Gemini web: ra prompt, màn hình kết quả hiện đúng.
- [ ] Sau khi xong, chỉ cuộc chat do app tạo bị xoá; chat cũ của bạn không bị đụng tới.
- [ ] Viết kịch bản bằng AI rồi tạo node từng cảnh.

**Tạo thật trên Google Flow (tốn credit, làm ít lượt)**
- [ ] Một ảnh từ prompt.
- [ ] Một video có 1–3 ảnh tham chiếu (Ingredients).
- [ ] Một video khung đầu (Frames).
- [ ] Tạo ảnh người mẫu bằng node Tạo ảnh (Flow), nối ảnh đó sang node Tạo video: video chạy được, node ảnh không còn báo "không chép được từ tab Flow", và video xong phát được ngay trong node.
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
npm test                      # chạy t1..t23 với ../cos-alpha-flow
node run-all.js t14 t15       # chỉ chạy vài test
node run-all.js D:\duong\dan\ban-khac t15   # test một bản extension khác
```

Trên Linux/macOS có thể dùng `./run-all.sh` thay cho `npm test`.

Mỗi test (t4–t23) in `PASS` / `FAIL` từng mục và ghi toàn bộ ra `out-tN.txt`. Kết quả mong đợi ở bản 1.10.0: tất cả đều qua.

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
| t14 | Canvas 1.6: thẻ node, hộp tìm node, Kho mẫu 11 mẫu, tự sắp xếp |
| t15 | Bật/tắt node, phóng to thẻ, kéo dây ra chỗ trống |
| t16 | Ảnh nhiều góc: tự chèn khi thả ảnh, Ctrl+Z, ô Kiểu ảnh, mẫu mới, chạy cả chuỗi bằng Gemini API giả |
| t17 | Ảnh / video Flow có link chuyển hướng sang host không cho đọc: vẫn chép về máy qua tab Flow, ảnh Flow → video, video phát trong node (cần lệnh `openssl`; không có thì test tự bỏ qua) |
| t18 | Chạy tất cả qua chuỗi 3 video *Nối khung cuối* khi trang app không đọc được video (như khi nằm ở tab nền): không treo, khung cuối lấy từ tab Flow; tab Flow tải lại giữa chừng thì báo mất kết nối, không gửi lại cảnh đó, vẫn chạy node sau |
| t19 | Flow giao diện tháng 11/2026 với **Tác nhân tắt**: app tự chuyển nút cài đặt sang Hình ảnh / Video (Khung hình hoặc Thành phần), tỉ lệ, thời lượng; khung đầu vào ô *Bắt đầu*; ảnh tải lên không bị lấy nhầm làm kết quả; "hoạt động bất thường" vẫn dừng cả lượt |
| t20 | Motion Studio: nút trên canvas mở trang; nạp video gốc + ảnh nhân vật; cắt đoạn bằng FFmpeg; mỗi đoạn gửi Flow ở Video · Thành phần kèm 1 video + ảnh nhân vật; ghép thành video dài bằng video gốc; tải lại trang vẫn còn dự án |
| t21 | Chạy 1 node có node tạo phía trước chưa xong: hỏi trước; Huỷ = chỉ chạy node đó; OK = chạy node phía trước rồi tới node đó; phía trước đã xong thì không hỏi |
| t22 | Motion Studio lời thoại: mặc định gửi đoạn video .mp4 vào tab Gemini (trang giả) để chép lời + dịch, không cần API key; chọn Gemini API thì gửi tới API; câu lệnh có câu thoại đã dịch, giọng mới theo mô tả, phụ đề; không gọi Gemini lại; sửa tay lời thoại rồi tạo lại dùng đúng câu đã sửa |
| t23 | Motion Studio âm thanh: ChatGPT (trang giả) nhận .wav và trả lời thoại có mốc thời gian; câu lệnh có Timeline + giọng mới; Flow báo "Không tạo được âm thanh" → tự bật "Trả về video không có âm thanh", gửi lại 1 lần; ghép lấy âm thanh gốc; nút Làm lại âm thanh |
