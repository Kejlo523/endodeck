package pl.endozero.endodeck;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.graphics.Color;
import android.os.Bundle;
import android.os.Handler;
import android.content.Context;
import android.content.SharedPreferences;
import android.view.View;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.JavascriptInterface;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.Iterator;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public final class MainActivity extends Activity {
    private static final String DECK_URL = "http://127.0.0.1:8765/";
    private static final String OFFLINE_URL = "file:///android_asset/offline.html";
    private final Handler handler = new Handler();
    private WebView webView;
    private boolean deckVisible;
    private boolean destroyed;
    private SharedPreferences preferences;
    private final ExecutorService deviceExecutor = Executors.newFixedThreadPool(3);
    private final ConcurrentHashMap<String, TapoClient> tapoClients = new ConcurrentHashMap<>();
    private final ConcurrentHashMap<String, Boolean> tapoStates = new ConcurrentHashMap<>();

    private final class DeckBridge {
        @JavascriptInterface
        public void setBrightness(final double value) {
            runOnUiThread(() -> {
                WindowManager.LayoutParams params = getWindow().getAttributes();
                params.screenBrightness = value < 0 ? WindowManager.LayoutParams.BRIGHTNESS_OVERRIDE_NONE
                    : Math.max(0.01f, Math.min(1f, (float) value));
                getWindow().setAttributes(params);
            });
        }

        @JavascriptInterface
        public void cacheWeather(String weatherJson) {
            if (weatherJson == null || weatherJson.length() > 100_000) return;
            preferences.edit()
                .putString("cached_weather", weatherJson)
                .putLong("cached_weather_at", System.currentTimeMillis())
                .apply();
        }

        @JavascriptInterface
        public String getCachedWeather() {
            return preferences.getString("cached_weather", "");
        }

        @JavascriptInterface
        public long getCachedWeatherAt() {
            return preferences.getLong("cached_weather_at", 0L);
        }

        @JavascriptInterface
        public void cacheAccent(String accent) {
            if (accent != null && accent.matches("^#[0-9a-fA-F]{6}$")) {
                preferences.edit().putString("cached_accent", accent).apply();
            }
        }

        @JavascriptInterface
        public String getCachedAccent() {
            return preferences.getString("cached_accent", "#b7f34a");
        }

        @JavascriptInterface
        public void cacheOfflineBundle(String bundleJson) {
            if (bundleJson == null || bundleJson.length() > 200_000) return;
            String previous = preferences.getString("offline_bundle", "{}");
            preferences.edit().putString("offline_bundle", bundleJson).apply();
            if (!bundleJson.equals(previous)) {
                tapoClients.clear();
                tapoStates.clear();
            }
        }

        @JavascriptInterface
        public String getOfflineBundle() {
            return preferences.getString("offline_bundle", "{}");
        }

        @JavascriptInterface
        public void refreshLocalDeviceStates() {
            try {
                org.json.JSONObject bundle = readOfflineBundle();
                if (!bundle.optBoolean("ready", false)) return;
                org.json.JSONObject devices = bundle.getJSONObject("devices");
                org.json.JSONObject tapo = bundle.getJSONObject("tapo");
                Iterator<String> keys = devices.keys();
                while (keys.hasNext()) {
                    final String alias = keys.next();
                    final org.json.JSONObject device = devices.getJSONObject(alias);
                    deviceExecutor.execute(() -> publishDeviceState(alias, readDeviceState(alias, device, tapo)));
                }
            } catch (Exception ignored) { }
        }

        @JavascriptInterface
        public void toggleLocalDeviceAsync(final String alias) {
            deviceExecutor.execute(() -> {
                long startedAt = System.currentTimeMillis();
                org.json.JSONObject result = new org.json.JSONObject();
                try {
                    org.json.JSONObject bundle = readOfflineBundle();
                    if (!bundle.optBoolean("ready", false)) throw new Exception("Brak zapisanych urzadzen Tapo");
                    org.json.JSONObject device = bundle.getJSONObject("devices").getJSONObject(alias);
                    org.json.JSONObject tapo = bundle.getJSONObject("tapo");
                    TapoClient client = getTapoClient(alias, device, tapo);
                    Boolean knownState = tapoStates.get(alias);
                    boolean active = knownState == null ? client.toggle() : client.setState(!knownState);
                    tapoStates.put(alias, active);
                    result.put("alias", alias);
                    result.put("kind", "toggle");
                    result.put("active", active);
                    result.put("available", true);
                } catch (Exception error) {
                    putDeviceError(result, alias, error);
                    try { result.put("kind", "toggle"); } catch (Exception ignored) { }
                }
                android.util.Log.d("EndoDeckTapo", "toggle " + alias + " in " + (System.currentTimeMillis() - startedAt) + " ms");
                publishDeviceState(alias, result);
            });
        }

        private org.json.JSONObject readDeviceState(String alias, org.json.JSONObject device, org.json.JSONObject tapo) {
            long startedAt = System.currentTimeMillis();
            org.json.JSONObject state = new org.json.JSONObject();
            try {
                boolean active = getTapoClient(alias, device, tapo).getState();
                tapoStates.put(alias, active);
                state.put("alias", alias);
                state.put("kind", "status");
                state.put("active", active);
                state.put("available", true);
            } catch (Exception error) {
                putDeviceError(state, alias, error);
            }
            android.util.Log.d("EndoDeckTapo", "status " + alias + " in " + (System.currentTimeMillis() - startedAt) + " ms");
            return state;
        }

        private TapoClient getTapoClient(String alias, org.json.JSONObject device, org.json.JSONObject tapo) throws Exception {
            TapoClient existing = tapoClients.get(alias);
            if (existing != null) return existing;
            TapoClient created = new TapoClient(device.getString("ip"), tapo.getString("username"), tapo.getString("password"));
            TapoClient raced = tapoClients.putIfAbsent(alias, created);
            return raced == null ? created : raced;
        }

        private void putDeviceError(org.json.JSONObject result, String alias, Exception error) {
            try {
                result.put("alias", alias);
                if (!result.has("kind")) result.put("kind", "status");
                result.put("active", tapoStates.containsKey(alias) && tapoStates.get(alias));
                result.put("available", false);
                result.put("error", friendlyTapoError(error));
            } catch (Exception ignored) { }
        }

        private String friendlyTapoError(Exception error) {
            String message = error.getMessage() == null ? "Blad Tapo" : error.getMessage();
            if (message.contains("timed out") || message.contains("connect")) return "Brak odpowiedzi w sieci Wi-Fi";
            if (message.contains("auth")) return "Bledne dane konta Tapo";
            return message;
        }

        private void publishDeviceState(String alias, org.json.JSONObject state) {
            final String payload = org.json.JSONObject.quote(state.toString());
            runOnUiThread(() -> {
                if (destroyed || webView == null) return;
                webView.evaluateJavascript("window.EndoDeckOffline&&window.EndoDeckOffline.receiveDeviceState(" + payload + ")", null);
            });
        }

        private org.json.JSONObject readOfflineBundle() throws org.json.JSONException {
            return new org.json.JSONObject(preferences.getString("offline_bundle", "{}"));
        }
    }

    private final Runnable connectionProbe = new Runnable() {
        @Override
        public void run() {
            new Thread(() -> {
                boolean available = false;
                HttpURLConnection connection = null;
                try {
                    connection = (HttpURLConnection) new URL(DECK_URL + "api/state").openConnection();
                    connection.setConnectTimeout(650);
                    connection.setReadTimeout(650);
                    connection.setUseCaches(false);
                    available = connection.getResponseCode() == 200;
                } catch (Exception ignored) {
                } finally {
                    if (connection != null) connection.disconnect();
                }

                final boolean serverAvailable = available;
                handler.post(() -> {
                    if (destroyed || isFinishing()) return;
                    if (serverAvailable && !deckVisible) {
                        webView.loadUrl(DECK_URL);
                    } else if (!serverAvailable && deckVisible) {
                        deckVisible = false;
                        webView.loadUrl(OFFLINE_URL);
                    }
                    handler.postDelayed(connectionProbe, serverAvailable ? 3000 : 1200);
                });
            }).start();
        }
    };

    @Override
    @SuppressLint("SetJavaScriptEnabled")
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        requestWindowFeature(Window.FEATURE_NO_TITLE);
        preferences = getSharedPreferences("endodeck", Context.MODE_PRIVATE);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        getWindow().setStatusBarColor(Color.BLACK);
        getWindow().setNavigationBarColor(Color.BLACK);

        webView = new WebView(this);
        webView.setBackgroundColor(Color.rgb(7, 9, 7));
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setCacheMode(WebSettings.LOAD_NO_CACHE);
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);
        settings.setMediaPlaybackRequiresUserGesture(false);
        webView.addJavascriptInterface(new DeckBridge(), "NativeDeck");

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageFinished(WebView view, String url) {
                deckVisible = url != null && url.startsWith(DECK_URL);
                if (deckVisible) setWindowBrightness(WindowManager.LayoutParams.BRIGHTNESS_OVERRIDE_NONE);
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame()) showOffline();
            }

            @Override
            @SuppressWarnings("deprecation")
            public void onReceivedError(WebView view, int errorCode, String description, String failingUrl) {
                if (failingUrl != null && failingUrl.startsWith(DECK_URL)) showOffline();
            }
        });

        setContentView(webView);
        enterImmersiveMode();
        webView.loadUrl(OFFLINE_URL);
        handler.post(connectionProbe);
    }

    private void showOffline() {
        if (!deckVisible && OFFLINE_URL.equals(webView.getUrl())) return;
        deckVisible = false;
        webView.loadUrl(OFFLINE_URL);
    }

    private void setWindowBrightness(float brightness) {
        WindowManager.LayoutParams params = getWindow().getAttributes();
        params.screenBrightness = brightness;
        getWindow().setAttributes(params);
    }

    private void enterImmersiveMode() {
        getWindow().getDecorView().setSystemUiVisibility(
            View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                | View.SYSTEM_UI_FLAG_FULLSCREEN
                | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
        );
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) enterImmersiveMode();
    }

    @Override
    protected void onDestroy() {
        destroyed = true;
        handler.removeCallbacksAndMessages(null);
        deviceExecutor.shutdownNow();
        if (webView != null) webView.destroy();
        super.onDestroy();
    }
}
