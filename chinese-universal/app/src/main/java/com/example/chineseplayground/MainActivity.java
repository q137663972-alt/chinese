package com.example.chineseplayground;

import android.Manifest;
import android.app.Activity;
import android.app.UiModeManager;
import android.content.Intent;
import android.content.pm.ActivityInfo;
import android.content.pm.PackageInfo;
import android.content.pm.PackageInstaller;
import android.content.pm.PackageManager;
import android.os.Bundle;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.IntentFilter;
import android.content.IntentSender;
import android.content.SharedPreferences;
import android.content.res.Configuration;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;
import android.view.KeyEvent;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

/**
 * 语文乐园 · 通用壳（手机 / 平板 / 电视 同一个 APK）
 *
 * 用系统 WebView 加载 assets 里的 H5：file:///android_asset/index.html
 * 主文档仍是 file:// —— origin 不能变，否则 localStorage 里的星星全丢。
 *
 * 原生层只负责四件事（其余全部在 H5 里，且都能热更）：
 *   1. 设备能力判定（AndroidDevice 桥）：让 H5 知道自己跑在手机、平板还是电视上
 *   2. 文件级热更（AndroidHot 桥）：下载资源包 → 落盘到 files/hot/，
 *      于是图片、音频、字体、新玩法的 js 全都能热更，不再受 localStorage 配额限制
 *   3. 虚拟域拦截（shouldInterceptRequest）：把 https://local.asset/ 和
 *      https://local.hot/ 映射成本地文件，不引入 androidx
 *   4. 全屏 / 音频放行 / 返回键 / 应用内升级
 *
 * 安全底线：不开 setAllowUniversalAccessFromFileURLs —— 那等于让网络下发的代码
 * 读整个私有目录。JS 需要联网取文本时走 AndroidHot.httpGet()，由原生代劳。
 */
public class MainActivity extends Activity {

    private static final int REQ_RECORD_AUDIO = 1001;

    /* ---------------- 虚拟域（不依赖 androidx 的 WebViewAssetLoader） ---------------- */
    private static final String HOST_ASSET = "local.asset";   // → APK assets/
    private static final String HOST_HOT   = "local.hot";     // → files/hot/

    /* ---------------- 热更状态（必须放 SharedPreferences，不能放 localStorage） -------
     * 热更的 js 来自网络。把逃生开关存在它能写的地方，等于没有逃生开关。 */
    private static final String PREF    = "hot_state";
    private static final String K_FAILS = "fails";
    private static final String K_BAD   = "bad";       // JSON 数组，坏掉的 build
    private static final String K_CUR   = "cur";
    private static final String K_OFF   = "disabled";
    private static final String K_APK   = "apk";         // 上次安装过的 APK 版本号（用于升级后清旧热更）

    private WebView webView;
    private SpeechRecognizer sr;
    private boolean srAvailable;
    private boolean pendingStart = false;
    /** 应用内升级：接收 PackageInstaller 的安装结果广播 */
    private BroadcastReceiver installReceiver;
    private long lastBackAt = 0;

    private File hotDir()    { return new File(getFilesDir(), "hot"); }
    private File hotNewDir() { return new File(getFilesDir(), "hot.new"); }
    private File hotOldDir() { return new File(getFilesDir(), "hot.old"); }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        webView = new WebView(this);
        setContentView(webView);

        WebSettings ws = webView.getSettings();
        ws.setJavaScriptEnabled(true);
        ws.setAllowFileAccess(true);
        // 只开这一个：主文档是 file://，要能加载本应用私有目录里的音频文件
        ws.setAllowFileAccessFromFileURLs(true);
        // 绝不开 setAllowUniversalAccessFromFileURLs(true)
        ws.setDomStorageEnabled(true);
        ws.setDatabaseEnabled(true);
        ws.setMediaPlaybackRequiresUserGesture(false);
        ws.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        ws.setBuiltInZoomControls(false);
        ws.setDisplayZoomControls(false);
        ws.setUseWideViewPort(true);
        ws.setLoadWithOverviewMode(true);
        ws.setTextZoom(100);                       // 锁死系统字体缩放，防大字体撑爆布局

        webView.setWebViewClient(new LocalClient());
        webView.setWebChromeClient(new WebChromeClient());

        /* 换了新 APK → 清掉旧热更残留：旧包可能是被判过「坏」或已熔断的版本，
           留着会让用户觉得「改了没生效」。清空后本次一定跑内置的最新代码，
           后台会重新拉一份干净的热更包。 */
        resetHotOnUpgrade();

        srAvailable = SpeechRecognizer.isRecognitionAvailable(this);
        if (srAvailable) {
            sr = SpeechRecognizer.createSpeechRecognizer(this);
            sr.setRecognitionListener(new SRListener());
            webView.addJavascriptInterface(new SRBridge(), "AndroidSR");
        }

        webView.addJavascriptInterface(new DeviceBridge(), "AndroidDevice");
        webView.addJavascriptInterface(new HotBridge(),    "AndroidHot");
        webView.addJavascriptInterface(new UpdateBridge(), "AndroidUpdate");

        installReceiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context c, Intent i) {
                if (i == null) return;
                int st = i.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE);
                String msg = i.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE);
                if (st == PackageInstaller.STATUS_PENDING_USER_ACTION) {
                    Intent confirm = i.getParcelableExtra(Intent.EXTRA_INTENT);
                    if (confirm != null) {
                        confirm.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                        try { startActivity(confirm); } catch (Exception ignored) {}
                    }
                } else if (st == PackageInstaller.STATUS_SUCCESS) {
                    reportUpdate("ok", "");
                } else {
                    reportUpdate("fail", String.valueOf(st) + " " + msg);
                }
            }
        };
        IntentFilter updFilter = new IntentFilter(getPackageName() + ".INSTALL_COMMIT");
        if (Build.VERSION.SDK_INT >= 33) {
            registerReceiver(installReceiver, updFilter, Context.RECEIVER_NOT_EXPORTED);
        } else {
            registerReceiver(installReceiver, updFilter);
        }

        applyOrientation();
        webView.loadUrl("file:///android_asset/index.html");
    }

    /* ============ 屏幕方向：电视锁横屏、手机锁竖屏、平板交给系统 ============ */
    private void applyOrientation() {
        if (isTVDevice()) {
            setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE);
        } else if (swDp() >= 600) {
            setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_USER);
        } else {
            setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_SENSOR_PORTRAIT);
        }
    }

    /* ============ 设备能力桥：H5 首屏脚本即可同步调用 ============ */
    private class DeviceBridge {
        /** 三重兜底：国产盒子常常既不是 UiModeManager 的 TELEVISION，也没有 leanback feature */
        @JavascriptInterface public boolean isTV() { return isTVDevice(); }
        @JavascriptInterface public int swDp() { return MainActivity.this.swDp(); }
        @JavascriptInterface public boolean hasTouch() {
            try { return getPackageManager().hasSystemFeature(PackageManager.FEATURE_TOUCHSCREEN); }
            catch (Exception e) { return true; }
        }
        @JavascriptInterface public boolean hasMic() { return srAvailable; }
        @JavascriptInterface public int sdkInt() { return Build.VERSION.SDK_INT; }
        @JavascriptInterface public int versionCode() {
            try {
                PackageInfo pi = getPackageManager().getPackageInfo(getPackageName(), 0);
                return (int) (Build.VERSION.SDK_INT >= 28 ? pi.getLongVersionCode() : pi.versionCode);
            } catch (Exception e) { return 0; }
        }
    }

    private boolean isTVDevice() {
        try {
            UiModeManager ui = (UiModeManager) getSystemService(UI_MODE_SERVICE);
            if (ui != null && ui.getCurrentModeType() == Configuration.UI_MODE_TYPE_TELEVISION) return true;
        } catch (Exception ignored) {}
        try {
            PackageManager pm = getPackageManager();
            if (pm != null && (pm.hasSystemFeature(PackageManager.FEATURE_LEANBACK)
                    || pm.hasSystemFeature("android.hardware.type.television"))) return true;
        } catch (Exception ignored) {}
        try {
            PackageManager pm = getPackageManager();
            /* 个别盒子会虚报 touchscreen 特性，被这条兜底误判成手机（竖屏锁死）。
               先排除真正能打电话的手机/平板（有 telephony 必不是电视盒子），
               再用「无触屏 → 电视」兜底，误判面就小多了。 */
            if (pm != null && pm.hasSystemFeature(PackageManager.FEATURE_TELEPHONY)) return false;
            if (pm != null && !pm.hasSystemFeature(PackageManager.FEATURE_TOUCHSCREEN)) return true;
        } catch (Exception ignored) {}
        return false;
    }

    private int swDp() {
        try { return getResources().getConfiguration().smallestScreenWidthDp; }
        catch (Exception e) { return 360; }
    }

    /* ==================== 文件级热更桥 ==================== */
    private class HotBridge {

        /** 音频用这个前缀拼 file:// 绝对路径（音频不走虚拟域，见文件头注释） */
        @JavascriptInterface public String base() { return "file://" + hotDir().getAbsolutePath() + "/"; }

        /** 同步返回 files/hot/MANIFEST.json 全文；没有热更包则返回空串 */
        @JavascriptInterface public String manifest() {
            try {
                File f = new File(hotDir(), "MANIFEST.json");
                if (!f.exists()) return "";
                return readAll(new FileInputStream(f));
            } catch (Exception e) { return ""; }
        }

        @JavascriptInterface public long freeBytes() {
            try { return getFilesDir().getUsableSpace(); } catch (Exception e) { return 0; }
        }

        @JavascriptInterface public String curBuild() { return pref().getString(K_CUR, ""); }

        /** 该 build 是否被标记为坏包 */
        @JavascriptInterface public boolean isBad(String build) {
            return build != null && build.length() > 0 && badList().contains(build);
        }

        /** 启动失败：标记坏包 + 回滚 + 累计失败次数。由 boot.js 的哨兵调用 */
        @JavascriptInterface public void markBad(String build) {
            SharedPreferences p = pref();
            List<String> bad = badList();
            if (build != null && build.length() > 0 && !bad.contains(build)) bad.add(build);
            if (bad.size() > 8) bad = new ArrayList<String>(bad.subList(bad.size() - 8, bad.size()));
            int f = p.getInt(K_FAILS, 0) + 1;
            SharedPreferences.Editor ed = p.edit()
                .putString(K_BAD, new JSONArray(bad).toString())
                .putInt(K_FAILS, f);
            if (f >= 2) ed.putBoolean(K_OFF, true);      // 连续两次 → 永久走内置
            ed.apply();
            rollback();
        }

        /** 启动成功：清除失败计数 */
        @JavascriptInterface public void markOk(String build) {
            pref().edit().putInt(K_FAILS, 0).putString(K_CUR, build == null ? "" : build).apply();
        }

        @JavascriptInterface public boolean isDisabled() { return pref().getBoolean(K_OFF, false); }

        @JavascriptInterface public void reset() { pref().edit().clear().apply(); }

        /** 回滚：优先还原上一版，否则直接删掉热更目录走内置 */
        @JavascriptInterface public void rollback() {
            try {
                File hot = hotDir(), old = hotOldDir();
                deleteDir(hot);
                if (old.exists()) old.renameTo(hot);
            } catch (Exception ignored) {}
        }

        /**
         * 下载资源包 → 解压到 hot.new → 校验 → rename 成 hot（原子切换）。
         * 启动永远只读 hot/，物理上不可能读到半包。
         * 回调：window.__onHotProgress(bytes) / window.__onHotPack(state, msg)
         */
        @JavascriptInterface public void installPack(final String url, final String sha256) {
            if (!urlAllowed(url)) { hotCall("fail", "url not allowed"); return; }
            new Thread(new Runnable() {
                @Override public void run() { doInstallPack(url, sha256); }
            }).start();
        }

        /** 联网取文本：JS 不直接 fetch —— file:// 下 XHR 受限，也不给跨源读文件的口子 */
        @JavascriptInterface public void httpGet(final String url, final String cb) {
            if (!urlAllowed(url)) { hotEval(cb + "(null)"); return; }
            new Thread(new Runnable() {
                @Override public void run() {
                    String t = openText(url);
                    hotEval(cb + "(" + (t == null ? "null" : JSONObject.quote(t)) + ")");
                }
            }).start();
        }
    }

    private SharedPreferences pref() { return getSharedPreferences(PREF, MODE_PRIVATE); }

    private int apkVersionCode() {
        try {
            PackageInfo pi = getPackageManager().getPackageInfo(getPackageName(), 0);
            return (int) (Build.VERSION.SDK_INT >= 28 ? pi.getLongVersionCode() : pi.versionCode);
        } catch (Exception e) { return 0; }
    }

    private void resetHotOnUpgrade() {
        try {
            SharedPreferences p = pref();
            int cur = apkVersionCode();
            if (cur <= 0) return;
            if (p.getInt(K_APK, 0) == cur) return;
            deleteDir(hotDir());
            deleteDir(hotNewDir());
            deleteDir(hotOldDir());
            File tmp = new File(getFilesDir(), "pack.tmp.zip");
            if (tmp.exists()) tmp.delete();
            p.edit().clear().putInt(K_APK, cur).apply();
        } catch (Exception ignored) {}
    }

    private List<String> badList() {
        List<String> out = new ArrayList<String>();
        try {
            JSONArray a = new JSONArray(pref().getString(K_BAD, "[]"));
            for (int i = 0; i < a.length(); i++) out.add(a.optString(i, ""));
        } catch (Exception ignored) {}
        return out;
    }

    private void doInstallPack(String url, String sha256) {
        File tmp = new File(getFilesDir(), "pack.tmp.zip");
        File staging = hotNewDir();
        try {
            InputStream in = openStream(url);
            if (in == null) { hotCall("fail", "download failed"); return; }

            deleteDir(staging);
            staging.mkdirs();
            /* 关键：先把当前 hot/ 整份复制到 staging，再解压覆盖。
               这样多个分包（assets.zip / code.zip）可以依次安装并叠加，
               后一个不会把前一个的内容抹掉。 */
            copyDir(hotDir(), staging);

            MessageDigest md = null;
            try { md = MessageDigest.getInstance("SHA-256"); } catch (Exception ignored) {}
            OutputStream out = new FileOutputStream(tmp);
            byte[] buf = new byte[64 * 1024];
            int n; long done = 0, last = 0;
            while ((n = in.read(buf)) > 0) {
                out.write(buf, 0, n);
                if (md != null) md.update(buf, 0, n);
                done += n;
                if (done - last > 256 * 1024) { last = done; reportHotProgress(done); }
            }
            out.close();
            try { in.close(); } catch (Exception ignored) {}
            reportHotProgress(done);

            if (sha256 != null && sha256.length() > 0 && md != null
                    && !hex(md.digest()).equalsIgnoreCase(sha256)) {
                tmp.delete(); deleteDir(staging);
                hotCall("fail", "sha mismatch");
                return;
            }

            /* 清单必须在 zip 里：保证清单与文件原子同源，不会出现「清单新、文件旧」 */
            if (!unzip(tmp, staging)) {
                tmp.delete(); deleteDir(staging);
                hotCall("fail", "bad pack");
                return;
            }
            tmp.delete();

            File hot = hotDir(), old = hotOldDir();
            deleteDir(old);
            if (hot.exists() && !hot.renameTo(old)) deleteDir(hot);
            if (!staging.renameTo(hot)) { hotCall("fail", "rename failed"); return; }

            hotCall("ok", "");
        } catch (Exception e) {
            tmp.delete(); deleteDir(staging);
            hotCall("fail", String.valueOf(e.getMessage()));
        }
    }

    private boolean unzip(File zip, File dest) {
        ZipInputStream zis = null;
        try {
            zis = new ZipInputStream(new FileInputStream(zip));
            ZipEntry e;
            byte[] buf = new byte[64 * 1024];
            while ((e = zis.getNextEntry()) != null) {
                if (e.isDirectory()) continue;
                File f = new File(dest, e.getName());
                if (!isInside(dest, f)) continue;               // 防 zip slip
                File parent = f.getParentFile();
                if (parent != null) parent.mkdirs();
                OutputStream os = new FileOutputStream(f);
                int n;
                while ((n = zis.read(buf)) > 0) os.write(buf, 0, n);
                os.close();
            }
            return true;
        } catch (Exception ex) {
            return false;
        } finally {
            if (zis != null) try { zis.close(); } catch (Exception ignored) {}
        }
    }

    private static boolean isInside(File dir, File f) {
        try {
            String d = dir.getCanonicalPath(), p = f.getCanonicalPath();
            return p.equals(d) || p.startsWith(d + File.separator);
        } catch (Exception e) { return false; }
    }

    private static void deleteDir(File d) {
        if (d == null || !d.exists()) return;
        if (d.isDirectory()) {
            File[] fs = d.listFiles();
            if (fs != null) for (File f : fs) deleteDir(f);
        }
        d.delete();
    }

    /** 把 src 整份复制进 dest（dest 已存在时覆盖同名文件）—— 用于多分包叠加安装 */
    private static void copyDir(File src, File dest) {
        if (src == null || !src.exists() || !src.isDirectory()) return;
        dest.mkdirs();
        File[] fs = src.listFiles();
        if (fs == null) return;
        for (File f : fs) {
            File t = new File(dest, f.getName());
            if (f.isDirectory()) { copyDir(f, t); continue; }
            InputStream in = null; OutputStream out = null;
            try {
                in = new FileInputStream(f);
                out = new FileOutputStream(t);
                byte[] b = new byte[64 * 1024];
                int n;
                while ((n = in.read(b)) > 0) out.write(b, 0, n);
            } catch (Exception ignored) {
            } finally {
                if (in != null) try { in.close(); } catch (Exception ignored) {}
                if (out != null) try { out.close(); } catch (Exception ignored) {}
            }
        }
    }

    private static String readAll(InputStream in) throws Exception {
        ByteArrayOutputStream bo = new ByteArrayOutputStream();
        byte[] b = new byte[8192]; int n;
        while ((n = in.read(b)) > 0) bo.write(b, 0, n);
        in.close();
        return bo.toString("UTF-8");
    }

    private static String hex(byte[] a) {
        StringBuilder s = new StringBuilder();
        for (byte b : a) s.append(String.format("%02x", b));
        return s.toString();
    }

    private void reportHotProgress(final long done) {
        runOnUiThread(new Runnable() {
            @Override public void run() {
                try {
                    webView.evaluateJavascript(
                        "window.__onHotProgress&&window.__onHotProgress(" + done + ")", null);
                } catch (Exception ignored) {}
            }
        });
    }
    private void hotCall(final String st, final String msg) {
        runOnUiThread(new Runnable() {
            @Override public void run() {
                try {
                    webView.evaluateJavascript(
                        "window.__onHotPack&&window.__onHotPack(" + JSONObject.quote(st) + ","
                            + JSONObject.quote(msg == null ? "" : msg) + ")", null);
                } catch (Exception ignored) {}
            }
        });
    }
    private void hotEval(final String js) {
        runOnUiThread(new Runnable() {
            @Override public void run() {
                try { webView.evaluateJavascript(js, null); } catch (Exception ignored) {}
            }
        });
    }

    /* ==================== 虚拟域拦截：local.asset / local.hot ==================== */
    private class LocalClient extends WebViewClient {
        @Override
        public WebResourceResponse shouldInterceptRequest(WebView v, WebResourceRequest req) {
            if (Build.VERSION.SDK_INT < 21) return null;
            Uri u = req.getUrl();
            String host = (u == null) ? null : u.getHost();
            if (host == null) return null;
            if (!HOST_ASSET.equals(host) && !HOST_HOT.equals(host)) return null;

            String path = u.getPath();
            if (path == null) return null;
            while (path.startsWith("/")) path = path.substring(1);
            if (path.length() == 0) return null;

            try {
                InputStream in;
                if (HOST_HOT.equals(host)) {
                    File f = new File(getFilesDir(), "hot/" + path);
                    if (!f.exists() || !isInside(hotDir(), f)) return null;
                    in = new FileInputStream(f);
                } else {
                    in = getAssets().open(path);
                }
                Map<String, String> h = new HashMap<String, String>();
                /* 必须带：否则 JS 用 fetch() 读热更文件会被 CORS 挡（<script src> 不受影响） */
                h.put("Access-Control-Allow-Origin", "*");
                h.put("Cache-Control", "no-cache");
                return new WebResourceResponse(guessMime(path), "utf-8", 200, "OK", h, in);
            } catch (Exception e) {
                return null;
            }
        }
    }

    private static String guessMime(String p) {
        String s = p.toLowerCase();
        if (s.endsWith(".js"))   return "application/javascript";
        if (s.endsWith(".css"))  return "text/css";
        if (s.endsWith(".json")) return "application/json";
        if (s.endsWith(".html")) return "text/html";
        if (s.endsWith(".webp")) return "image/webp";
        if (s.endsWith(".png"))  return "image/png";
        if (s.endsWith(".jpg") || s.endsWith(".jpeg")) return "image/jpeg";
        if (s.endsWith(".svg"))  return "image/svg+xml";
        if (s.endsWith(".woff2")) return "font/woff2";
        if (s.endsWith(".woff")) return "font/woff";
        if (s.endsWith(".ttf"))  return "font/ttf";
        if (s.endsWith(".mp3"))  return "audio/mpeg";
        return "application/octet-stream";
    }

    /* ==================== 原生语音识别桥 ==================== */
    private class SRBridge {
        @JavascriptInterface public boolean isAvailable() { return srAvailable && sr != null; }
        @JavascriptInterface public void start() {
            runOnUiThread(new Runnable() {
                @Override public void run() { startSR(); }
            });
        }
    }

    private void startSR() {
        if (sr == null) { reportError(); return; }
        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            pendingStart = true;
            requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO}, REQ_RECORD_AUDIO);
            return;
        }
        try {
            Intent intent = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
            intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
            // 语文跟读必须中文识别（旧壳沿用了英语项目的 en-US，这里一并修正）
            intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE, "zh-CN");
            intent.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1);
            sr.startListening(intent);
        } catch (Exception e) { reportError(); }
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        if (requestCode == REQ_RECORD_AUDIO) {
            pendingStart = false;
            if (grantResults != null && grantResults.length > 0
                    && grantResults[0] == PackageManager.PERMISSION_GRANTED) startSR();
            else reportError();
        }
    }

    private void reportResult(final String text) {
        final String js = "window.__onNativeSRResult(" + JSONObject.quote(text == null ? "" : text) + ")";
        runOnUiThread(new Runnable() {
            @Override public void run() {
                try { webView.evaluateJavascript(js, null); } catch (Exception ignored) {}
            }
        });
    }

    private void reportError() {
        final String js = "window.__onNativeSRError && window.__onNativeSRError('麦克风被禁用了，可以直接点「我读啦，过关」')";
        runOnUiThread(new Runnable() {
            @Override public void run() {
                try { webView.evaluateJavascript(js, null); } catch (Exception ignored) {}
            }
        });
    }

    private class SRListener implements RecognitionListener {
        @Override public void onResults(Bundle results) {
            ArrayList<String> m = results.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
            reportResult(m != null && !m.isEmpty() ? m.get(0) : "");
        }
        @Override public void onError(int error) { reportError(); }
        @Override public void onReadyForSpeech(Bundle params) {}
        @Override public void onBeginningOfSpeech() {}
        @Override public void onRmsChanged(float rmsdB) {}
        @Override public void onBufferReceived(byte[] buffer) {}
        @Override public void onEndOfSpeech() {}
        @Override public void onPartialResults(Bundle partialResults) {}
        @Override public void onEvent(int eventType, Bundle params) {}
    }

    /* ==================== 应用内升级（APK） ====================
     * H5 通过 window.AndroidUpdate 调用。下载地址必须命中白名单 —— 因为热更的远程 JS
     * 同样能调到这个桥，不限制域名等于允许远程代码安装任意 APK。
     * ========================================================== */
    private static final String[] APK_HOSTS = {
        "https://github.com/q137663972-alt/",
        "https://ghfast.top/https://github.com/q137663972-alt/",
        "https://ghproxy.net/https://github.com/q137663972-alt/",
        "https://gh-proxy.com/https://github.com/q137663972-alt/",
        "https://q137663972-alt.github.io/",
        "https://cdn.jsdelivr.net/gh/q137663972-alt/",
        "https://fastly.jsdelivr.net/gh/q137663972-alt/"
    };

    private class UpdateBridge {
        @JavascriptInterface public int getVersionCode() {
            try {
                PackageInfo pi = getPackageManager().getPackageInfo(getPackageName(), 0);
                return (int) (Build.VERSION.SDK_INT >= 28 ? pi.getLongVersionCode() : pi.versionCode);
            } catch (Exception e) { return 0; }
        }
        @JavascriptInterface public String getVersionName() {
            try { return getPackageManager().getPackageInfo(getPackageName(), 0).versionName; }
            catch (Exception e) { return "0"; }
        }
        @JavascriptInterface public boolean canInstall() {
            if (Build.VERSION.SDK_INT < 26) return true;
            try { return getPackageManager().canRequestPackageInstalls(); }
            catch (Exception e) { return false; }
        }
        @JavascriptInterface public void openInstallPermission() {
            if (Build.VERSION.SDK_INT < 26) return;
            try {
                Intent it = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                        Uri.parse("package:" + getPackageName()));
                it.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                startActivity(it);
            } catch (Exception ignored) {}
        }
        @JavascriptInterface public void install(final String url, final String mirrorUrl) {
            if (!urlAllowed(url)) { reportUpdate("fail", "url not allowed"); return; }
            if (!canInstall()) { openInstallPermission(); reportUpdate("need-permission", ""); return; }
            new Thread(new Runnable() {
                @Override public void run() { doInstall(url, mirrorUrl); }
            }).start();
        }
    }

    private boolean urlAllowed(String u) {
        if (u == null || u.length() == 0) return false;
        for (int i = 0; i < APK_HOSTS.length; i++) {
            if (u.startsWith(APK_HOSTS[i])) return true;
        }
        return false;
    }

    private void doInstall(String url, String mirrorUrl) {
        PackageInstaller.Session session = null;
        try {
            InputStream in = openStream(url);
            if (in == null && urlAllowed(mirrorUrl)) in = openStream(mirrorUrl);
            if (in == null) { reportUpdate("fail", "download failed"); return; }

            PackageInstaller pi = getPackageManager().getPackageInstaller();
            PackageInstaller.SessionParams params =
                    new PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL);
            params.setAppPackageName(getPackageName());
            int sid = pi.createSession(params);
            session = pi.openSession(sid);

            OutputStream out = session.openWrite("base", 0, -1);
            byte[] buf = new byte[64 * 1024];
            int n; long done = 0, last = 0;
            while ((n = in.read(buf)) > 0) {
                out.write(buf, 0, n);
                done += n;
                if (done - last > 256 * 1024) { last = done; reportProgress(done); }
            }
            session.fsync(out);
            try { in.close(); } catch (Exception ignored) {}
            try { out.close(); } catch (Exception ignored) {}

            Intent bi = new Intent(getPackageName() + ".INSTALL_COMMIT");
            bi.setPackage(getPackageName());
            int flags = PendingIntent.FLAG_UPDATE_CURRENT;
            if (Build.VERSION.SDK_INT >= 23) flags |= PendingIntent.FLAG_IMMUTABLE;
            PendingIntent pend = PendingIntent.getBroadcast(MainActivity.this, sid, bi, flags);
            session.commit(pend.getIntentSender());
            reportProgress(-1);                       // 交给系统安装界面
        } catch (Exception e) {
            reportUpdate("fail", String.valueOf(e.getMessage()));
        } finally {
            if (session != null) { try { session.close(); } catch (Exception ignored) {} }
        }
    }

    private InputStream openStream(String u) {
        try {
            java.net.HttpURLConnection c =
                    (java.net.HttpURLConnection) new java.net.URL(u).openConnection();
            c.setInstanceFollowRedirects(true);       // release 下载地址是 302 到 CDN
            c.setConnectTimeout(15000);
            c.setReadTimeout(30000);
            c.connect();
            int code = c.getResponseCode();
            if (code >= 200 && code < 300) return c.getInputStream();
            c.disconnect();
        } catch (Exception ignored) {}
        return null;
    }

    private String openText(String u) {
        InputStream in = openStream(u);
        if (in == null) return null;
        try { return readAll(in); } catch (Exception e) { return null; }
    }

    private void reportProgress(final long done) {
        runOnUiThread(new Runnable() {
            @Override public void run() {
                try {
                    webView.evaluateJavascript(
                        "window.__onUpdateProgress && window.__onUpdateProgress(" + done + ")", null);
                } catch (Exception ignored) {}
            }
        });
    }

    private void reportUpdate(final String st, final String msg) {
        runOnUiThread(new Runnable() {
            @Override public void run() {
                try {
                    webView.evaluateJavascript(
                        "window.__onUpdateDone && window.__onUpdateDone(" + JSONObject.quote(st) + ","
                            + JSONObject.quote(msg == null ? "" : msg) + ")", null);
                } catch (Exception ignored) {}
            }
        });
    }

    /* ==================== 返回键 / 遥控器确认键 ==================== */
    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event) {
        if (keyCode == KeyEvent.KEYCODE_BACK) {
            long now = System.currentTimeMillis();
            if (now - lastBackAt < 400) return true;              // debounce：连按会 finish 两次
            lastBackAt = now;
            webView.evaluateJavascript(
                "(function(){ return window.tvBack ? window.tvBack() : true; })()",
                new ValueCallback<String>() {
                    @Override
                    public void onReceiveValue(String v) {
                        if (!"true".equals(v)) finish();
                    }
                });
            return true;
        }
        return super.onKeyDown(keyCode, event);
    }

    @Override
    public boolean dispatchKeyEvent(KeyEvent event) {
        if (event.getAction() == KeyEvent.ACTION_UP
                && (event.getKeyCode() == KeyEvent.KEYCODE_DPAD_CENTER
                    || event.getKeyCode() == KeyEvent.KEYCODE_ENTER)) {
            /* 电视上 js/tv.js 已经在 keydown 里处理过确认键了（带 220ms 防抖）。
               这里再 click() 一次 → 按一下点两下，表现为「OK 键要按两次」。
               tv.js 起来后会打上 window.__tvKeyHandled，此时原生退让，
               只在 tv.js 没跑到（非电视 / 脚本异常）时才兜底点一下。 */
            webView.evaluateJavascript(
                "(function(){ if(window.__tvKeyHandled) return false; " +
                "var e=document.activeElement; if(e&&e.click){e.click(); return true;} return false;})()",
                null);
        }
        return super.dispatchKeyEvent(event);
    }

    @Override
    protected void onPause() {
        if (sr != null) { try { sr.stopListening(); } catch (Exception ignored) {} }
        webView.evaluateJavascript("if(window.speechSynthesis) speechSynthesis.cancel();", null);
        super.onPause();
    }

    @Override
    protected void onDestroy() {
        if (sr != null) { try { sr.destroy(); } catch (Exception ignored) {} sr = null; }
        if (installReceiver != null) {
            try { unregisterReceiver(installReceiver); } catch (Exception ignored) {}
            installReceiver = null;
        }
        if (webView != null) webView.destroy();
        super.onDestroy();
    }
}
