package com.example.chineseplayground;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Bundle;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.IntentFilter;
import android.content.IntentSender;
import android.content.pm.PackageInfo;
import android.content.pm.PackageInstaller;
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
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import org.json.JSONObject;

/**
 * 英语乐园 · 安卓电视/机顶盒壳
 * 用系统 WebView 加载 assets 里的 H5（index.html#tv → 进入遥控器模式）。
 * 所有交互、发音、游戏逻辑都在 H5 中实现，原生层只负责：全屏横屏、音频/混流放行、
 * 返回键逐级回 H5 导航栈、D-pad 按键透传给 WebView。
 *
 * 额外职责：当设备带麦遥控器且系统语音识别可用时，通过 JS 桥（window.AndroidSR）
 * 把原生 SpeechRecognizer 暴露给 H5 的跟读游戏；无麦/拒授权时 H5 自动回落手动兜底。
 */
public class MainActivity extends Activity {

    private static final int REQ_RECORD_AUDIO = 1001;

    private WebView webView;
    private SpeechRecognizer sr;
    private boolean srAvailable;
    private boolean pendingStart = false;
    /** 应用内升级：接收 PackageInstaller 的安装结果广播 */
    private BroadcastReceiver installReceiver;


    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        webView = new WebView(this);
        setContentView(webView);

        WebSettings ws = webView.getSettings();
        ws.setJavaScriptEnabled(true);
        ws.setAllowFileAccess(true);
        ws.setAllowFileAccessFromFileURLs(true);
        ws.setAllowUniversalAccessFromFileURLs(true);
        ws.setDomStorageEnabled(true);
        ws.setDatabaseEnabled(true);
        // 允许自动播放音频 / 允许 https 资源从 file:// 页面加载（有道 MP3）
        ws.setMediaPlaybackRequiresUserGesture(false);
        ws.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        ws.setBuiltInZoomControls(false);
        ws.setDisplayZoomControls(false);
        ws.setUseWideViewPort(true);
        ws.setLoadWithOverviewMode(true);

        webView.setWebViewClient(new WebViewClient());
        webView.setWebChromeClient(new WebChromeClient());

        // 仅当系统语音识别可用时，才把原生桥注入给 H5（无麦设备不暴露空桥）
        srAvailable = SpeechRecognizer.isRecognitionAvailable(this);
        if (srAvailable) {
            sr = SpeechRecognizer.createSpeechRecognizer(this);
            sr.setRecognitionListener(new SRListener());
            webView.addJavascriptInterface(new SRBridge(), "AndroidSR");
        }

        // #tv 触发 H5 的电视/遥控器适配

        // 应用内升级桥 + 安装结果广播（H5 通过 window.AndroidUpdate 调用）
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

        webView.loadUrl("file:///android_asset/index.html#tv");
    }

    /** 原生语音识别桥：H5 通过 window.AndroidSR 调用 */
    private class SRBridge {
        @JavascriptInterface
        public boolean isAvailable() {
            return srAvailable && sr != null;
        }

        @JavascriptInterface
        public void start() {
            runOnUiThread(new Runnable() {
                @Override
                public void run() { startSR(); }
            });
        }
    }

    /** 启动识别：先确认录音权限，授权后再 startListening */
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
            intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE, "en-US");
            intent.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1);
            sr.startListening(intent);
        } catch (Exception e) {
            reportError();
        }
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        if (requestCode == REQ_RECORD_AUDIO) {
            pendingStart = false;
            if (grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED) {
                startSR();
            } else {
                reportError(); // 拒绝授权 → H5 回落手动兜底
            }
        }
    }

    private void reportResult(final String text) {
        // 用 JSONObject.quote 做 JSON 转义（静态方法，不抛受检异常）
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

    /** 识别结果回传 H5 */
    private class SRListener implements RecognitionListener {
        @Override
        public void onResults(Bundle results) {
            java.util.ArrayList<String> matches =
                results.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
            String text = (matches != null && !matches.isEmpty()) ? matches.get(0) : "";
            reportResult(text);
        }

        @Override
        public void onError(int error) { reportError(); }

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
     * 用 PackageInstaller.Session 流式写入，不需要 FileProvider，也不需要 androidx。
     * ========================================================== */
    private static final String[] APK_HOSTS = {
        "https://github.com/q137663972-alt/",
        "https://ghfast.top/https://github.com/q137663972-alt/",
        "https://ghproxy.net/https://github.com/q137663972-alt/",
        "https://gh-proxy.com/https://github.com/q137663972-alt/",
        "https://q137663972-alt.github.io/"
    };

    private class UpdateBridge {
        @JavascriptInterface
        public int getVersionCode() {
            try {
                PackageInfo pi = getPackageManager().getPackageInfo(getPackageName(), 0);
                return (int) (Build.VERSION.SDK_INT >= 28 ? pi.getLongVersionCode() : pi.versionCode);
            } catch (Exception e) { return 0; }
        }

        @JavascriptInterface
        public String getVersionName() {
            try { return getPackageManager().getPackageInfo(getPackageName(), 0).versionName; }
            catch (Exception e) { return "0"; }
        }

        @JavascriptInterface
        public boolean canInstall() {
            if (Build.VERSION.SDK_INT < 26) return true;
            try { return getPackageManager().canRequestPackageInstalls(); }
            catch (Exception e) { return false; }
        }

        @JavascriptInterface
        public void openInstallPermission() {
            if (Build.VERSION.SDK_INT < 26) return;
            try {
                Intent it = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                        Uri.parse("package:" + getPackageName()));
                it.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                startActivity(it);
            } catch (Exception ignored) {}
        }

        @JavascriptInterface
        public void install(final String url, final String mirrorUrl) {
            if (!apkUrlAllowed(url)) { reportUpdate("fail", "url not allowed"); return; }
            if (!canInstall()) { openInstallPermission(); reportUpdate("need-permission", ""); return; }
            new Thread(new Runnable() {
                @Override public void run() { doInstall(url, mirrorUrl); }
            }).start();
        }
    }

    private boolean apkUrlAllowed(String u) {
        if (u == null || u.length() == 0) return false;
        for (int i = 0; i < APK_HOSTS.length; i++) {
            if (u.startsWith(APK_HOSTS[i])) return true;
        }
        return false;
    }

    private void doInstall(String url, String mirrorUrl) {
        PackageInstaller.Session session = null;
        try {
            java.io.InputStream in = openStream(url);
            if (in == null && apkUrlAllowed(mirrorUrl)) in = openStream(mirrorUrl);
            if (in == null) { reportUpdate("fail", "download failed"); return; }

            PackageInstaller pi = getPackageManager().getPackageInstaller();
            PackageInstaller.SessionParams params =
                    new PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL);
            params.setAppPackageName(getPackageName());
            int sid = pi.createSession(params);
            session = pi.openSession(sid);

            java.io.OutputStream out = session.openWrite("base", 0, -1);
            byte[] buf = new byte[64 * 1024];
            int n;
            long done = 0, last = 0;
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
            IntentSender sender = pend.getIntentSender();
            session.commit(sender);
            reportProgress(-1);                       // 交给系统安装界面
        } catch (Exception e) {
            reportUpdate("fail", String.valueOf(e.getMessage()));
        } finally {
            if (session != null) { try { session.close(); } catch (Exception ignored) {} }
        }
    }

    private java.io.InputStream openStream(String u) {
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

    private void reportProgress(final long done) {
        runOnUiThread(new Runnable() {
            @Override public void run() {
                try { webView.evaluateJavascript("window.__onUpdateProgress && window.__onUpdateProgress(" + done + ")", null); }
                catch (Exception ignored) {}
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

    /** 返回键：先让 H5 逐级回退，回到首页则退出应用 */
    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event) {
        if (keyCode == KeyEvent.KEYCODE_BACK) {
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
