// 문서 → PDF 파일 내려받기 (브라우저 안에서 만든다)
// 화면에 그린 계약서(HTML)를 이미지로 찍어 A4 한 장 PDF 로 저장한다. 라이브러리는 처음 쓸 때만 불러온다.
// 이 PDF 는 보관·전달용 사본이다. 법적 증빙의 기준은 저장된 서명 기록(서명 시각·계정·문서 해시)이다.
const LIBS = ["https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js", "https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js"];
const loaded = {};
const loadScript = (src) => (loaded[src] ||= new Promise((resolve, reject) => {
  const s = document.createElement("script"); s.src = src; s.onload = resolve; s.onerror = () => { delete loaded[src]; reject(new Error("PDF 도구를 불러오지 못했습니다. 네트워크를 확인하세요.")); };
  document.head.appendChild(s);
}));

export async function downloadPdf(html, filename) {
  await Promise.all(LIBS.map(loadScript));
  const fr = document.createElement("iframe");
  fr.style.cssText = "position:fixed;left:-10000px;top:0;width:800px;height:1300px;border:0;background:#fff";
  document.body.appendChild(fr);
  try {
    await new Promise((resolve) => { fr.onload = resolve; fr.srcdoc = html; });
    await new Promise((r) => setTimeout(r, 250));   // 한 장 맞춤(글자 크기 조절)이 끝나길 기다린다
    const body = fr.contentDocument.body;
    const canvas = await globalThis.html2canvas(body, { scale: 2, backgroundColor: "#ffffff", useCORS: true });
    const pdf = new globalThis.jspdf.jsPDF({ unit: "mm", format: "a4" });
    const W = 190, H = 277;   // 여백 10mm
    let w = W, h = (canvas.height * W) / canvas.width;
    if (h > H) { w = (W * H) / h; h = H; }
    pdf.addImage(canvas.toDataURL("image/jpeg", 0.95), "JPEG", 10 + (W - w) / 2, 10, w, h);
    pdf.save(filename);
  } finally { fr.remove(); }
}
