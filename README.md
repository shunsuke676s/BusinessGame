# ビジネスゲーム　〜飲料販売〜

小売店の発注・受注をテーマにした経営シミュレーションゲーム（Vite + React + PWA）。

## セットアップ（要 Node.js 18 以上）

```bash
npm install
npm run dev
```

`http://localhost:5173` で動作確認できます。

## ビルド（公開用の静的ファイルを生成）

```bash
npm run build
```

`dist/` フォルダに公開用の静的ファイル一式が出力されます。`npm run preview` でビルド後の内容をローカル確認できます。

## 公開する（例: Vercel）

1. このフォルダを GitHub リポジトリに push する
2. [Vercel](https://vercel.com) にログインし、そのリポジトリを Import する
3. Framework Preset は「Vite」を選択（Build Command: `npm run build`、Output Directory: `dist`）
4. Deploy を押すと数十秒で公開 URL が発行される

Netlify や Cloudflare Pages でも同様の手順で公開できます。

## iPhone でアプリのように使う

公開 URL を iPhone の Safari で開き、共有メニューから「ホーム画面に追加」を選ぶと、
アイコンをタップしてネイティブアプリのように起動できます（PWA）。

## 広告を組み込む

`index.html` の `<head>` 内にコメントで挿入例を記載しています。
Google AdSense の審査に通過したら、発行された `client=ca-pub-XXXXXXXXXXXXXXXX` を
自分のものに差し替えてコメントを外してください。

決算画面への遷移時や、資金が不足した場面に「広告を見てボーナス資金を得る」といった
リワード広告を組み込むと、ゲーム体験を大きく損ねずに収益化しやすくなります。

## アイコンについて

`public/icons/icon-192.png` / `icon-512.png` は仮のアイコンです。
実際に公開する際は、お好みのデザインに差し替えてください。

## 法的表記について

広告収益が発生するサイトを運営する場合は、プライバシーポリシーや利用規約の整備を
検討してください（Google AdSense の利用にはプライバシーポリシーの掲示が必須です）。
