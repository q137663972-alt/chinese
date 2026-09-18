package com.example.chineseplayground;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Bundle;
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
        if (webView != null) webView.destroy();
        super.onDestroy();
    }
}
