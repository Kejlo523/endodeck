package pl.endozero.endodeck;

import org.json.JSONObject;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.Arrays;
import javax.crypto.Cipher;
import javax.crypto.spec.IvParameterSpec;
import javax.crypto.spec.SecretKeySpec;

final class TapoClient {
    private final String ip;
    private final String username;
    private final String password;
    private byte[] key;
    private byte[] iv;
    private int seq;
    private byte[] sig;
    private String sessionCookie;

    TapoClient(String ip, String username, String password) {
        this.ip = ip;
        this.username = username;
        this.password = password;
    }

    synchronized boolean getState() throws Exception {
        JSONObject info = request("get_device_info", null);
        return info.optBoolean("device_on", info.optBoolean("on", false));
    }

    synchronized boolean toggle() throws Exception {
        boolean current = getState();
        return setState(!current);
    }

    synchronized boolean setState(boolean active) throws Exception {
        JSONObject params = new JSONObject();
        params.put("device_on", active);
        request("set_device_info", params);
        return active;
    }

    private JSONObject request(String method, JSONObject params) throws Exception {
        if (key == null) initialize();
        JSONObject payload = new JSONObject();
        payload.put("method", method);
        if (params != null) payload.put("params", params);
        seq += 1;
        byte[] encrypted = encrypt(payload.toString().getBytes("UTF-8"));
        byte[] response = postRaw("request", encrypted, "seq=" + seq, false);
        JSONObject data = new JSONObject(new String(decrypt(response), "UTF-8"));
        if (data.optInt("error_code", -1) != 0) {
            key = null;
            throw new Exception("Tapo error " + data.optInt("error_code"));
        }
        return data.optJSONObject("result") == null ? new JSONObject() : data.getJSONObject("result");
    }

    private void initialize() throws Exception {
        sessionCookie = null;
        byte[] localSeed = randomBytes(16);
        byte[] authHash = authHash(username, password);
        byte[] response = postRaw("handshake1", localSeed, null, true);
        if (response.length < 48) throw new Exception("Tapo handshake failed");
        if (sessionCookie == null) throw new Exception("Tapo brak TP_SESSIONID");
        byte[] remoteSeed = Arrays.copyOfRange(response, 0, 16);
        byte[] serverHash = Arrays.copyOfRange(response, 16, 48);
        if (!Arrays.equals(sha256(concat(localSeed, remoteSeed, authHash)), serverHash)) {
            throw new Exception("Tapo auth failed");
        }
        postRaw("handshake2", sha256(concat(remoteSeed, localSeed, authHash)), null, false);
        byte[] localHash = concat(localSeed, remoteSeed, authHash);
        key = Arrays.copyOf(sha256(concat("lsk".getBytes("UTF-8"), localHash)), 16);
        byte[] ivseq = sha256(concat("iv".getBytes("UTF-8"), localHash));
        iv = Arrays.copyOfRange(ivseq, 0, 12);
        seq = ByteBuffer.wrap(Arrays.copyOfRange(ivseq, ivseq.length - 4, ivseq.length)).order(ByteOrder.BIG_ENDIAN).getInt();
        sig = Arrays.copyOf(sha256(concat("ldk".getBytes("UTF-8"), localHash)), 28);
    }

    private byte[] encrypt(byte[] data) throws Exception {
        int pad = 16 - (data.length % 16);
        byte[] padded = Arrays.copyOf(data, data.length + pad);
        Arrays.fill(padded, data.length, padded.length, (byte) pad);
        byte[] seqBytes = seqBytes();
        Cipher cipher = Cipher.getInstance("AES/CBC/NoPadding");
        cipher.init(Cipher.ENCRYPT_MODE, new SecretKeySpec(key, "AES"), new IvParameterSpec(concat(iv, seqBytes)));
        byte[] ciphertext = cipher.doFinal(padded);
        byte[] signature = sha256(concat(sig, seqBytes, ciphertext));
        return concat(signature, ciphertext);
    }

    private byte[] decrypt(byte[] data) throws Exception {
        byte[] seqBytes = seqBytes();
        Cipher cipher = Cipher.getInstance("AES/CBC/NoPadding");
        cipher.init(Cipher.DECRYPT_MODE, new SecretKeySpec(key, "AES"), new IvParameterSpec(concat(iv, seqBytes)));
        byte[] decrypted = cipher.doFinal(Arrays.copyOfRange(data, 32, data.length));
        int pad = decrypted[decrypted.length - 1] & 0xFF;
        return Arrays.copyOf(decrypted, decrypted.length - pad);
    }

    private byte[] postRaw(String path, byte[] body, String query, boolean captureCookie) throws Exception {
        String url = "http://" + ip + "/app/" + path + (query == null ? "" : "?" + query);
        HttpURLConnection connection = (HttpURLConnection) new URL(url).openConnection();
        connection.setConnectTimeout(1600);
        connection.setReadTimeout(2400);
        connection.setRequestMethod("POST");
        connection.setDoOutput(true);
        connection.setUseCaches(false);
        if (sessionCookie != null) connection.setRequestProperty("Cookie", sessionCookie);
        OutputStream output = connection.getOutputStream();
        output.write(body);
        output.flush();
        output.close();
        int code = connection.getResponseCode();
        if (captureCookie) sessionCookie = readSessionCookie(connection);
        InputStream stream = code >= 200 && code < 300 ? connection.getInputStream() : connection.getErrorStream();
        ByteArrayOutputStream buffer = new ByteArrayOutputStream();
        byte[] chunk = new byte[512];
        int read;
        while (stream != null && (read = stream.read(chunk)) != -1) buffer.write(chunk, 0, read);
        connection.disconnect();
        if (code < 200 || code >= 300) throw new Exception("Tapo HTTP " + code);
        return buffer.toByteArray();
    }

    private static String readSessionCookie(HttpURLConnection connection) {
        for (int index = 0; ; index++) {
            String key = connection.getHeaderFieldKey(index);
            String value = connection.getHeaderField(index);
            if (key == null && value == null) break;
            if (key != null && key.equalsIgnoreCase("Set-Cookie") && value != null && value.startsWith("TP_SESSIONID=")) {
                int end = value.indexOf(';');
                return end < 0 ? value : value.substring(0, end);
            }
        }
        return null;
    }

    private byte[] seqBytes() {
        return ByteBuffer.allocate(4).order(ByteOrder.BIG_ENDIAN).putInt(seq).array();
    }

    private static byte[] randomBytes(int size) {
        byte[] bytes = new byte[size];
        new SecureRandom().nextBytes(bytes);
        return bytes;
    }

    private static byte[] authHash(String user, String pass) throws Exception {
        return sha256(concat(sha1(user.getBytes("UTF-8")), sha1(pass.getBytes("UTF-8"))));
    }

    private static byte[] sha1(byte[] data) throws Exception {
        return MessageDigest.getInstance("SHA-1").digest(data);
    }

    private static byte[] sha256(byte[] data) throws Exception {
        return MessageDigest.getInstance("SHA-256").digest(data);
    }

    private static byte[] concat(byte[]... parts) {
        int size = 0;
        for (byte[] part : parts) size += part.length;
        byte[] out = new byte[size];
        int offset = 0;
        for (byte[] part : parts) {
            System.arraycopy(part, 0, out, offset, part.length);
            offset += part.length;
        }
        return out;
    }
}
