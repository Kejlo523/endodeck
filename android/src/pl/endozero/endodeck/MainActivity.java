package pl.endozero.endodeck;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.graphics.Color;
import android.os.Bundle;
import android.os.Handler;
import android.content.Context;
import android.content.Intent;
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
import java.net.URLEncoder;
import java.io.InputStreamReader;
import java.util.Calendar;
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
    private boolean nightStandby;
    private SharedPreferences preferences;
    private SecureStore secureStore;
    private String sessionToken = "";
    private long lastOfflineBundleSync;
    private final ExecutorService deviceExecutor = Executors.newFixedThreadPool(3);
    private final ConcurrentHashMap<String, TapoClient> tapoClients = new ConcurrentHashMap<>();
    private final ConcurrentHashMap<String, Boolean> tapoStates = new ConcurrentHashMap<>();
    private static final String NIGHT_MARKER = "/data/local/tmp/endodeck-night-standby";
    private static final int NIGHT_STANDBY_END_HOUR = 7;

    private final Runnable nightBoundary = new Runnable() {
        @Override
        public void run() {
            if (isNightHours()) {
                if (!deckVisible) enterNightStandby();
            } else if (nightStandby) {
                leaveNightStandby();
            }
            scheduleNextNightBoundary();
        }
    };

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
            storeOfflineBundle(bundleJson);
        }

        @JavascriptInterface
        public String getOfflineBundle() {
            String value = secureStore.get("offline_bundle");
            return value.isEmpty() ? "{}" : value;
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
            if (message.contains("HTTP 403")) return "Tapo odrzuca sterowanie lokalne";
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
            String value = secureStore.get("offline_bundle");
            return new org.json.JSONObject(value.isEmpty() ? "{}" : value);
        }
    }

    private final Runnable connectionProbe = new Runnable() {
        @Override
        public void run() {
            new Thread(() -> {
                boolean available = false;
                HttpURLConnection connection = null;
                try {
                    if (sessionToken == null || sessionToken.isEmpty()) throw new Exception("Missing session token");
                    connection = (HttpURLConnection) new URL(DECK_URL + "api/config").openConnection();
                    connection.setConnectTimeout(650);
                    connection.setReadTimeout(650);
                    connection.setUseCaches(false);
                    connection.setRequestProperty("Authorization", "Bearer " + sessionToken);
                    available = connection.getResponseCode() == 200;
                } catch (Exception ignored) {
                } finally {
                    if (connection != null) connection.disconnect();
                }

                if (available) refreshOfflineBundle();

                final boolean serverAvailable = available;
                handler.post(() -> {
                    if (destroyed || isFinishing()) return;
                    if (serverAvailable) {
                        if (nightStandby) leaveNightStandby();
                        if (!deckVisible) webView.loadUrl(authenticatedDeckUrl());
                    } else if (!serverAvailable && deckVisible) {
                        deckVisible = false;
                        webView.loadUrl(OFFLINE_URL);
                    }
                    handler.postDelayed(connectionProbe, nightStandby ? 15000 : serverAvailable ? 3000 : 1200);
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
        secureStore = new SecureStore(this);
        acceptSessionToken(getIntent());
        String legacyBundle = preferences.getString("offline_bundle", "");
        if (!legacyBundle.isEmpty() && secureStore.get("offline_bundle").isEmpty()) {
            try { secureStore.put("offline_bundle", legacyBundle); preferences.edit().remove("offline_bundle").apply(); } catch (Exception ignored) { }
        }
        nightStandby = preferences.getBoolean("night_standby", false);
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
        scheduleNextNightBoundary();
        if (nightStandby) {
            handler.postDelayed(isNightHours() ? this::enterNightStandby : this::leaveNightStandby, 1800);
        }
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        boolean tokenChanged = acceptSessionToken(intent);
        if (tokenChanged && webView != null) {
            deckVisible = false;
            lastOfflineBundleSync = 0L;
            webView.loadUrl(authenticatedDeckUrl());
        }
    }

    private boolean acceptSessionToken(Intent intent) {
        String providedToken = intent == null ? null : intent.getStringExtra("endodeck_token");
        if (providedToken == null || providedToken.isEmpty()) {
            if (sessionToken == null || sessionToken.isEmpty()) sessionToken = secureStore.get("api_token");
            return false;
        }
        boolean changed = !providedToken.equals(sessionToken);
        sessionToken = providedToken;
        try { secureStore.put("api_token", providedToken); } catch (Exception ignored) { }
        return changed;
    }

    private void refreshOfflineBundle() {
        long now = System.currentTimeMillis();
        if (now - lastOfflineBundleSync < 30_000L) return;
        lastOfflineBundleSync = now;
        HttpURLConnection connection = null;
        try {
            connection = (HttpURLConnection) new URL(DECK_URL + "api/offline-bundle").openConnection();
            connection.setConnectTimeout(1200);
            connection.setReadTimeout(2500);
            connection.setUseCaches(false);
            connection.setRequestProperty("Authorization", "Bearer " + sessionToken);
            if (connection.getResponseCode() != 200) return;
            StringBuilder body = new StringBuilder();
            try (InputStreamReader reader = new InputStreamReader(connection.getInputStream(), "UTF-8")) {
                char[] buffer = new char[4096];
                int read;
                while ((read = reader.read(buffer)) != -1) {
                    body.append(buffer, 0, read);
                    if (body.length() > 200_000) return;
                }
            }
            new org.json.JSONObject(body.toString());
            storeOfflineBundle(body.toString());
        } catch (Exception error) {
            android.util.Log.w("EndoDeckOffline", "Offline bundle sync failed", error);
        } finally {
            if (connection != null) connection.disconnect();
        }
    }

    private void storeOfflineBundle(String bundleJson) {
        if (bundleJson == null || bundleJson.length() > 200_000) return;
        String previous = secureStore.get("offline_bundle");
        try { secureStore.put("offline_bundle", bundleJson); } catch (Exception ignored) { return; }
        if (!bundleJson.equals(previous)) {
            tapoClients.clear();
            tapoStates.clear();
        }
    }

    private boolean isNightHours() {
        return Calendar.getInstance().get(Calendar.HOUR_OF_DAY) < NIGHT_STANDBY_END_HOUR;
    }

    private String authenticatedDeckUrl() {
        if (sessionToken == null || sessionToken.isEmpty()) return DECK_URL;
        try { return DECK_URL + "?token=" + URLEncoder.encode(sessionToken, "UTF-8"); }
        catch (Exception ignored) { return DECK_URL; }
    }

    private void scheduleNextNightBoundary() {
        handler.removeCallbacks(nightBoundary);
        Calendar next = Calendar.getInstance();
        if (isNightHours()) {
            next.set(Calendar.HOUR_OF_DAY, NIGHT_STANDBY_END_HOUR);
        } else {
            next.add(Calendar.DAY_OF_YEAR, 1);
            next.set(Calendar.HOUR_OF_DAY, 0);
        }
        next.set(Calendar.MINUTE, 0);
        next.set(Calendar.SECOND, 0);
        next.set(Calendar.MILLISECOND, 0);
        handler.postDelayed(nightBoundary, Math.max(1000L, next.getTimeInMillis() - System.currentTimeMillis()));
    }

    private void enterNightStandby() {
        if (destroyed || deckVisible) return;
        nightStandby = true;
        preferences.edit().putBoolean("night_standby", true).apply();
        getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        if (webView != null) {
            webView.onPause();
            webView.pauseTimers();
        }
        setWindowBrightness(0.01f);
        runRootCommand("/system/bin/endodeckctl sleep-night");
    }

    private void leaveNightStandby() {
        nightStandby = false;
        preferences.edit().putBoolean("night_standby", false).apply();
        runRootCommand("/system/bin/endodeckctl wake");
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        if (webView != null) {
            webView.resumeTimers();
            webView.onResume();
        }
        setWindowBrightness(WindowManager.LayoutParams.BRIGHTNESS_OVERRIDE_NONE);
    }

    private void runRootCommand(final String command) {
        new Thread(() -> {
            try {
                Process process = Runtime.getRuntime().exec(new String[] { "su", "-c", command });
                process.waitFor();
            } catch (Exception error) {
                android.util.Log.w("EndoDeckPower", "Root command failed", error);
            }
        }).start();
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
    protected void onResume() {
        super.onResume();
        if (nightStandby) {
            handler.postDelayed(isNightHours() ? this::enterNightStandby : this::leaveNightStandby, 1800);
        }
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
