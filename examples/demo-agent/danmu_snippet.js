// 优酷弹幕提取代码
// 在优酷视频页按F12，控制台粘贴运行

// 1. 提取弹幕ID
const html = document.documentElement.innerHTML;
const daluIdMatch = html.match(/"daluId":"([^"]+)"/);
if (daluIdMatch) {
    console.log("弹幕ID:", daluIdMatch[1]);
}

// 2. 提取页面可见弹幕
const danmus = [];
const selectors = [
    '[class*="danmu"]',
    '[class*="bullet"]',
    '[class*="dm-"]',
    '.dm-item',
    '.danmu-item'
];

selectors.forEach(sel => {
    document.querySelectorAll(sel).forEach(el => {
        const text = el.innerText || el.textContent;
        if (text && text.trim() && !danmus.includes(text.trim())) {
            danmus.push(text.trim());
        }
    });
});

console.log("提取到", danmus.length, "条弹幕:");
danmus.forEach((d, i) => console.log((i+1) + ". " + d));

// 3. 下载为JSON文件
const blob = new Blob([JSON.stringify(danmus, null, 2)], {type: "application/json"});
const url = URL.createObjectURL(blob);
const a = document.createElement("a");
a.href = url;
a.download = "youku_danmu_" + new Date().getTime() + ".json";
a.click();
URL.revokeObjectURL(url);

console.log("✅ 弹幕已下载到本地");
