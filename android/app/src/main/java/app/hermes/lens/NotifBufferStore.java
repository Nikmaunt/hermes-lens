package app.hermes.lens;

import android.util.AtomicFile;

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;

/**
 * The on-disk ring buffer behind NotifBridge: app-private
 * files/notif-buffer.jsonl, one JSON entry per line, oldest first.
 *
 * All access is serialized on a process-wide lock (the listener service and
 * the Capacitor bridge run on different threads of the same process), and
 * every write goes through {@link AtomicFile} — a crash mid-write leaves the
 * previous file intact, never a half-written buffer. Failed writes are
 * swallowed: for an append that silently drops one event, for an ack the
 * entries simply replay on the next drain, where the web layer's stable
 * clientId dedups them.
 */
final class NotifBufferStore {

    static final String FILE_NAME = "notif-buffer.jsonl";

    private static final Object LOCK = new Object();

    private NotifBufferStore() {}

    /** Every buffered line, oldest first. Never throws; unreadable → empty. */
    static List<String> readLines(File filesDir) {
        synchronized (LOCK) {
            return readLocked(atomicFile(filesDir));
        }
    }

    /**
     * Appends one entry, keeping the buffer a ring of {@link NotifCapture#RING_MAX}
     * (overflow evicts the oldest). A line whose id is already buffered is a
     * repeat post of the same notification and is NOT duplicated.
     */
    static void append(File filesDir, String id, String jsonLine) {
        synchronized (LOCK) {
            AtomicFile file = atomicFile(filesDir);
            List<String> lines = readLocked(file);
            for (String line : lines) {
                if (id.equals(idOf(line))) {
                    return;
                }
            }
            lines.add(jsonLine);
            writeLocked(file, NotifCapture.pruneRing(lines, NotifCapture.RING_MAX));
        }
    }

    /**
     * Drops entries up to and including {@code upToId}. An unknown id (double
     * ack, or the entry was already evicted by the ring) is a no-op — never an
     * error, and never a reason to drop unacked entries.
     */
    static void ackUpTo(File filesDir, String upToId) {
        synchronized (LOCK) {
            AtomicFile file = atomicFile(filesDir);
            List<String> lines = readLocked(file);
            for (int i = 0; i < lines.size(); i++) {
                if (upToId.equals(idOf(lines.get(i)))) {
                    writeLocked(file, new ArrayList<>(lines.subList(i + 1, lines.size())));
                    return;
                }
            }
        }
    }

    private static AtomicFile atomicFile(File filesDir) {
        return new AtomicFile(new File(filesDir, FILE_NAME));
    }

    private static String idOf(String line) {
        try {
            return new JSONObject(line).optString("id", "");
        } catch (Throwable t) {
            return "";
        }
    }

    private static List<String> readLocked(AtomicFile file) {
        List<String> out = new ArrayList<>();
        if (!file.getBaseFile().exists()) {
            return out;
        }
        try (BufferedReader reader = new BufferedReader(
                new InputStreamReader(file.openRead(), StandardCharsets.UTF_8))) {
            String line;
            while ((line = reader.readLine()) != null) {
                if (!line.trim().isEmpty()) {
                    out.add(line);
                }
            }
        } catch (IOException ignored) {
            // Unreadable buffer degrades to empty — capture starts over rather
            // than surfacing an error (and never crashes the caller).
        }
        return out;
    }

    private static void writeLocked(AtomicFile file, List<String> lines) {
        FileOutputStream out = null;
        try {
            out = file.startWrite();
            StringBuilder sb = new StringBuilder();
            for (String line : lines) {
                sb.append(line).append('\n');
            }
            out.write(sb.toString().getBytes(StandardCharsets.UTF_8));
            file.finishWrite(out);
        } catch (IOException e) {
            if (out != null) {
                file.failWrite(out);
            }
        }
    }
}
