package io.github.gangstagggg.daybreak;

import android.Manifest;
import android.app.AlertDialog;
import android.content.ContentValues;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.MediaStore;
import android.util.Base64;
import android.webkit.JavascriptInterface;
import android.webkit.JsResult;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.Toast;

import androidx.activity.ComponentActivity;
import androidx.activity.OnBackPressedCallback;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import androidx.webkit.WebViewAssetLoader;

import java.io.OutputStream;

/**
 * Viser webappen som ligger i assets (mappen web/ i repoet) inne i en WebView.
 *
 * Webappen lastes fra https://appassets.androidplatform.net/assets/index.html, så den
 * får en ekte https-opprinnelse. Da fungerer localStorage og IndexedDB som i en nettleser,
 * og dataene ligger i appens egen private lagring (de forsvinner hvis appen avinstalleres).
 */
public class MainActivity extends ComponentActivity {

    private static final String HOST = "appassets.androidplatform.net";
    private static final String START_URL = "https://" + HOST + "/assets/index.html";
    private static final int FILE_CHOOSER_REQUEST = 1001;
    private static final int NOTIF_REQUEST = 2002;

    private WebView webView;
    private ValueCallback<Uri[]> filePathCallback;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // Fra Android 15 tegnes appen bak statuslinjen og navigasjonslinjen. Marginene
        // legges på igjen under, slik at innholdet ikke havner bak dem.
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        WindowInsetsControllerCompat controller =
                WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        boolean light = getResources().getBoolean(R.bool.light_theme);
        controller.setAppearanceLightStatusBars(light);
        controller.setAppearanceLightNavigationBars(light);

        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(getColor(R.color.app_background));

        webView = new WebView(this);
        webView.setBackgroundColor(getColor(R.color.app_background));
        root.addView(webView, new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));
        setContentView(root);

        ViewCompat.setOnApplyWindowInsetsListener(root, (view, windowInsets) -> {
            Insets bars = windowInsets.getInsets(
                    WindowInsetsCompat.Type.systemBars()
                            | WindowInsetsCompat.Type.displayCutout()
                            | WindowInsetsCompat.Type.ime());
            view.setPadding(bars.left, bars.top, bars.right, bars.bottom);
            return WindowInsetsCompat.CONSUMED;
        });

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);   // uten denne forsvinner localStorage ved omstart
        settings.setDatabaseEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);

        final WebViewAssetLoader assetLoader = new WebViewAssetLoader.Builder()
                .setDomain(HOST)
                .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this))
                .build();

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                return assetLoader.shouldInterceptRequest(request.getUrl());
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if (HOST.equals(uri.getHost())) {
                    return false;
                }
                // Eksterne lenker åpnes i nettleseren, ikke inne i appen.
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, uri));
                } catch (Exception ignored) {
                    // Ingen app kunne åpne lenken.
                }
                return true;
            }
        });

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onJsAlert(WebView view, String url, String message, JsResult result) {
                new AlertDialog.Builder(MainActivity.this)
                        .setMessage(message)
                        .setPositiveButton(android.R.string.ok, (d, w) -> result.confirm())
                        .setOnCancelListener(d -> result.cancel())
                        .show();
                return true;
            }

            @Override
            public boolean onJsConfirm(WebView view, String url, String message, JsResult result) {
                new AlertDialog.Builder(MainActivity.this)
                        .setMessage(message)
                        .setPositiveButton(android.R.string.ok, (d, w) -> result.confirm())
                        .setNegativeButton(android.R.string.cancel, (d, w) -> result.cancel())
                        .setOnCancelListener(d -> result.cancel())
                        .show();
                return true;
            }

            // Gjør at <input type="file"> virker, for eksempel ved import av data.
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback,
                                             FileChooserParams params) {
                if (filePathCallback != null) {
                    filePathCallback.onReceiveValue(null);
                }
                filePathCallback = callback;
                try {
                    startActivityForResult(params.createIntent(), FILE_CHOOSER_REQUEST);
                } catch (Exception e) {
                    filePathCallback = null;
                    return false;
                }
                return true;
            }
        });

        // Lar webappen lagre filer i Nedlastinger (eksport). Se references/web-integration.md.
        webView.addJavascriptInterface(new Bridge(), "AndroidBridge");

        // Tilbake-knappen. Fra Android 16 kalles ikke onBackPressed(), derfor dispatcher.
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                // Webappen kan definere window.onAndroidBack() og returnere true når den
                // selv håndterte tilbake (for eksempel lukket en dialog).
                webView.evaluateJavascript(
                        "(typeof window.onAndroidBack === 'function' && window.onAndroidBack() === true)",
                        value -> {
                            if ("true".equals(value)) {
                                return;
                            }
                            if (webView.canGoBack()) {
                                webView.goBack();
                            } else {
                                setEnabled(false);
                                getOnBackPressedDispatcher().onBackPressed();
                            }
                        });
            }
        });

        if (savedInstanceState != null) {
            webView.restoreState(savedInstanceState);
        } else {
            webView.loadUrl(START_URL);
        }
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        webView.saveState(outState);
    }

    @Override
    protected void onPause() {
        webView.onPause();
        super.onPause();
    }

    @Override
    protected void onResume() {
        super.onResume();
        webView.onResume();
    }

    @Override
    protected void onDestroy() {
        webView.destroy();
        super.onDestroy();
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == FILE_CHOOSER_REQUEST) {
            if (filePathCallback != null) {
                filePathCallback.onReceiveValue(
                        WebChromeClient.FileChooserParams.parseResult(resultCode, data));
                filePathCallback = null;
            }
            return;
        }
        super.onActivityResult(requestCode, resultCode, data);
    }

    private void notifyPermissionResult(boolean granted) {
        webView.evaluateJavascript(
                "window.onNotifPermission && window.onNotifPermission(" + granted + ")", null);
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == NOTIF_REQUEST) {
            notifyPermissionResult(grantResults.length > 0
                    && grantResults[0] == PackageManager.PERMISSION_GRANTED);
        }
    }

    /** Broen webappen kan kalle som window.AndroidBridge.saveFile(...). */
    private class Bridge {
        @JavascriptInterface
        public boolean hasNotificationPermission() {
            return Build.VERSION.SDK_INT < 33
                    || checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)
                    == PackageManager.PERMISSION_GRANTED;
        }

        @JavascriptInterface
        public void requestNotificationPermission() {
            runOnUiThread(() -> {
                if (Build.VERSION.SDK_INT >= 33) {
                    requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, NOTIF_REQUEST);
                } else {
                    notifyPermissionResult(true);
                }
            });
        }

        @JavascriptInterface
        public void scheduleMorning(String json) {
            Notifier.schedule(getApplicationContext(), json);
        }

        @JavascriptInterface
        public void cancelMorning() {
            Notifier.cancel(getApplicationContext());
        }

        @JavascriptInterface
        public void showNow(String title, String body) {
            Notifier.show(getApplicationContext(), title, body);
        }

        @JavascriptInterface
        public boolean saveFile(String fileName, String mimeType, String base64Data) {
            try {
                byte[] data = Base64.decode(base64Data, Base64.DEFAULT);
                ContentValues values = new ContentValues();
                values.put(MediaStore.Downloads.DISPLAY_NAME, fileName);
                values.put(MediaStore.Downloads.MIME_TYPE, mimeType);
                values.put(MediaStore.Downloads.IS_PENDING, 1);
                Uri item = getContentResolver().insert(
                        MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
                if (item == null) {
                    return false;
                }
                try (OutputStream out = getContentResolver().openOutputStream(item)) {
                    out.write(data);
                }
                values.clear();
                values.put(MediaStore.Downloads.IS_PENDING, 0);
                getContentResolver().update(item, values, null, null);
                runOnUiThread(() -> Toast.makeText(MainActivity.this,
                        getString(R.string.saved_to_downloads, fileName),
                        Toast.LENGTH_LONG).show());
                return true;
            } catch (Exception e) {
                return false;
            }
        }
    }
}
