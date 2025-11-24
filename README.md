# Game Gallery (Static)

Trang tĩnh để hiển thị danh sách các game (đọc file .txt trong thư mục `Info`) và gallery ảnh lấy từ một repo ảnh riêng.

Hướng dẫn nhanh:

- Đặt file `.txt` cho mỗi game trong thư mục `Info` tại repo chứa site này. Tên file phải là `TênGame.txt`.
- Tạo 1 repo riêng để chứa ảnh. Trong repo ảnh, mỗi game có 1 thư mục có tên đúng bằng tên game, chứa ảnh (png/jpg/webp...).
- Sao chép `config.example.json` thành `config.json` và điền thông tin GitHub: repo chứa `Info` (site) và repo ảnh.
- Host bằng GitHub Pages: bật Pages trên branch `main` (hoặc branch bạn đã cấu hình).

Lưu ý về rate limits:
- Site sử dụng GitHub API công khai để liệt kê file và ảnh. Không authenticated request bị giới hạn thấp (60 requests/giờ theo IP).
- Nếu cần tăng giới hạn, tạo một Personal Access Token (PAT) và dán vào ô `GitHub Token` trên giao diện — không commit token vào repo!

Files:
- `index.html` - giao diện chính
- `style.css` - kiểu
- `app.js` - logic: gọi GitHub API để lấy danh sách file và ảnh
- `config.example.json` - ví dụ cấu hình

Local `Info` mode
- Nếu bạn muốn đặt các file `.txt` trực tiếp trong repo site (được host cùng trang), bật `localInfo` trong `config.json`.
- Tạo file chỉ mục `Info/index.json` (hoặc đường dẫn bạn đặt vào `infoIndexPath`) có định dạng JSON mảng, ví dụ:

```
[ "Ori.txt", "Hades.txt", "Undertale.txt" ]
```

- Hoặc bạn có thể dùng mảng object để chỉ định các path riêng:

```
[ { "name": "Ori", "path": "Info/Ori.txt" }, { "name": "Hades", "path": "Info/Hades.txt" } ]
```

- Khi site được host (GitHub Pages), các file `Info/<TênGame>.txt` sẽ được tải trực tiếp bởi `app.js` mà không cần gọi GitHub API.

Per-file image metadata
- Bạn có thể ghi metadata cho gallery ngay ở đầu file `.txt` bằng một block front-matter dạng YAML-like, ví dụ:

```
---
imagesRawBaseUrl: https://raw.githubusercontent.com/MDat-Module/ImgHost/main
imagesFilenamePattern: FinalFantasyXV_{n}.jpg
imagesStart: 1
imagesEnd: 12
imagesNumberPadding: 3
images:
 - FinalFantasyXV_001.jpg
 - FinalFantasyXV_002.jpg
---

Nội dung cảm nhận về game ở đây...
```

- Giải thích:
  - `images` (array): danh sách URL đầy đủ hoặc tên file; tên file sẽ được nối với `imagesRawBaseUrl` và thư mục theo tên game nếu không phải URL đầy đủ.
  - `imagesRawBaseUrl`: base raw URL (ví dụ raw.githubusercontent) để nối khi `images` chứa tên file.
  - `imagesFilenamePattern`: mẫu tên file sử dụng `{game}` và `{n}` để sinh nhiều file.
  - `imagesStart` / `imagesEnd` / `imagesNumberPadding`: phạm vi và padding cho số trong mẫu.

Ứng dụng sẽ ưu tiên metadata nội bộ này khi hiển thị gallery cho game. Nếu không có metadata, nó sẽ dùng `config.json` (global) hoặc fallback sang GitHub API.

Ví dụ cấu hình `config.json`:

{
  "siteRepoOwner": "your-user",
  "siteRepoName": "Game-Gallery",
  "siteBranch": "main",
  "imagesRepoOwner": "your-user",
  "imagesRepoName": "Game-Images",
  "imagesRepoBranch": "main",
  "imagesFolderPrefix": "" 
}

Sau khi cấu hình, mở trang (GitHub Pages) — danh sách game sẽ hiện ở cột trái. Bấm tên game để xem nội dung `.txt` và album ảnh (thu nhỏ). Bấm ảnh để xem full-screen.
