"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { FFmpeg } from "@ffmpeg/ffmpeg";
import { fetchFile, toBlobURL } from "@ffmpeg/util";

const bitrates = ["128", "192", "256", "320"];

function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function DownloadIcon() {
  return <span aria-hidden="true">↓</span>;
}

export default function Home() {
  const inputRef = useRef<HTMLInputElement>(null);
  const ffmpegRef = useRef<FFmpeg | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [bitrate, setBitrate] = useState("320");
  const [dragging, setDragging] = useState(false);
  const [status, setStatus] = useState<"idle" | "loading" | "converting" | "done" | "error">("idle");
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState("");
  const [downloadUrl, setDownloadUrl] = useState("");

  useEffect(() => {
    return () => {
      if (downloadUrl) URL.revokeObjectURL(downloadUrl);
    };
  }, [downloadUrl]);

  const chooseFile = useCallback((candidate?: File) => {
    if (!candidate) return;
    const isOgg =
      candidate.name.toLowerCase().endsWith(".ogg") ||
      candidate.type === "audio/ogg" ||
      candidate.type === "application/ogg";

    if (!isOgg) {
      setStatus("error");
      setMessage("请选择 .ogg 格式的音频文件。");
      return;
    }
    if (candidate.size > 250 * 1024 * 1024) {
      setStatus("error");
      setMessage("文件不能超过 250 MB。");
      return;
    }

    if (downloadUrl) URL.revokeObjectURL(downloadUrl);
    setDownloadUrl("");
    setFile(candidate);
    setProgress(0);
    setMessage("");
    setStatus("idle");
  }, [downloadUrl]);

  async function convert() {
    if (!file || status === "loading" || status === "converting") return;

    try {
      setStatus("loading");
      setProgress(2);
      setMessage("正在准备离线转换引擎，首次使用会稍等片刻…");

      let ffmpeg = ffmpegRef.current;
      if (!ffmpeg) {
        ffmpeg = new FFmpeg();
        ffmpeg.on("progress", ({ progress: value }) => {
          setProgress(Math.max(3, Math.min(99, Math.round(value * 100))));
        });
        const engineBase = "https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/umd";
        await ffmpeg.load({
          coreURL: await toBlobURL(`${engineBase}/ffmpeg-core.js`, "text/javascript"),
          wasmURL: await toBlobURL(`${engineBase}/ffmpeg-core.wasm`, "application/wasm"),
        });
        ffmpegRef.current = ffmpeg;
      }

      setStatus("converting");
      setMessage("正在转换，音频只在这台设备上处理…");
      await ffmpeg.writeFile("input.ogg", await fetchFile(file));
      await ffmpeg.exec([
        "-i",
        "input.ogg",
        "-map_metadata",
        "0",
        "-codec:a",
        "libmp3lame",
        "-b:a",
        `${bitrate}k`,
        "output.mp3",
      ]);

      const data = await ffmpeg.readFile("output.mp3");
      const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
      const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "audio/mpeg" }));
      setDownloadUrl(url);
      setProgress(100);
      setStatus("done");
      setMessage("转换完成，可以下载 MP3 了。");
      await ffmpeg.deleteFile("input.ogg");
      await ffmpeg.deleteFile("output.mp3");
    } catch {
      setStatus("error");
      setMessage("转换没有成功，请刷新页面后重试，或换一个 OGG 文件。");
    }
  }

  const outputName = file ? file.name.replace(/\.ogg$/i, "") + ".mp3" : "converted.mp3";

  return (
    <main>
      <header className="topbar">
        <a className="brand" href="/" aria-label="音转首页">
          <span className="brandMark">音</span>
          <span>音转</span>
        </a>
        <span className="privacyPill">仅在本机处理</span>
      </header>

      <section className="hero">
        <p className="eyebrow">OGG → MP3</p>
        <h1>把声音，换一种<br /><em>更通用的格式。</em></h1>
        <p className="lede">拖入 OGG 音频，几步转成 MP3。无需上传，无需注册，文件始终留在你的设备里。</p>
      </section>

      <section className="converter" aria-label="音频转换器">
        <div
          className={`dropzone ${dragging ? "dragging" : ""} ${file ? "hasFile" : ""}`}
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            chooseFile(event.dataTransfer.files[0]);
          }}
        >
          <input
            ref={inputRef}
            type="file"
            accept=".ogg,audio/ogg,application/ogg"
            onChange={(event) => chooseFile(event.target.files?.[0])}
          />
          {file ? (
            <div className="fileCard">
              <div className="fileBadge">OGG</div>
              <div className="fileInfo">
                <strong>{file.name}</strong>
                <span>{formatBytes(file.size)}</span>
              </div>
              <button className="replaceButton" onClick={() => inputRef.current?.click()}>更换</button>
            </div>
          ) : (
            <button className="dropButton" onClick={() => inputRef.current?.click()}>
              <span className="uploadMark">＋</span>
              <strong>把 OGG 文件拖到这里</strong>
              <span>或点击选择文件 · 最大 250 MB</span>
            </button>
          )}
        </div>

        <div className="controls">
          <div>
            <label htmlFor="quality">MP3 音质</label>
            <p>数值越高，音质和文件体积越大</p>
          </div>
          <select id="quality" value={bitrate} onChange={(event) => setBitrate(event.target.value)} disabled={status === "converting"}>
            {bitrates.map((value) => <option key={value} value={value}>{value} kbps{value === "320" ? " · 高品质" : ""}</option>)}
          </select>
        </div>

        {(status === "loading" || status === "converting" || status === "done") && (
          <div className="progressWrap" aria-live="polite">
            <div className="progressMeta"><span>{message}</span><strong>{progress}%</strong></div>
            <div className="progressTrack"><span style={{ width: `${progress}%` }} /></div>
          </div>
        )}
        {status === "error" && <p className="errorMessage" role="alert">{message}</p>}

        {status === "done" ? (
          <a className="primaryButton download" href={downloadUrl} download={outputName}>
            <DownloadIcon /> 下载 {outputName}
          </a>
        ) : (
          <button className="primaryButton" disabled={!file || status === "loading" || status === "converting"} onClick={convert}>
            {status === "loading" ? "正在准备…" : status === "converting" ? "正在转换…" : "开始转换为 MP3"}
            <span aria-hidden="true">→</span>
          </button>
        )}
      </section>

      <section className="trust">
        <article><span>01</span><h2>不上传</h2><p>转换在浏览器本地完成，音频不会发送到任何服务器。</p></article>
        <article><span>02</span><h2>不留存</h2><p>关闭页面后，文件和转换记录不会被保留。</p></article>
        <article><span>03</span><h2>够简单</h2><p>无需账号、无需安装，一次选择即可完成。</p></article>
      </section>

      <footer><span>音转 · 简单、私密的音频转换</span><span>支持桌面与移动浏览器</span></footer>
    </main>
  );
}
