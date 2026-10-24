package io.github.gangstagggg.daybreak;

import android.Manifest;
import android.app.AlarmManager;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.os.Build;

import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Lokale morgenvarsler. Webappen sender de neste ukene som ferdige tekster
 * ([{at, title, body}]), og hver blir en alarm. Alarmene overlever omstart (BootReceiver).
 * Åpner brukeren appen, planlegges alt på nytt med oppdaterte tekster.
 */
public final class Notifier {
    static final String CHANNEL = "morning";
    private static final String PREFS = "daybreak_alarms";
    private static final String KEY = "list";
    private static final int BASE_CODE = 4000;
    private static final int MAX = 30;

    private Notifier() {}

    private static SharedPreferences prefs(Context ctx) {
        return ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    private static PendingIntent pending(Context ctx, int code, String title, String body) {
        Intent i = new Intent(ctx, AlarmReceiver.class);
        i.putExtra("title", title);
        i.putExtra("body", body);
        return PendingIntent.getBroadcast(ctx, code, i,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private static void cancelAlarms(Context ctx) {
        AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
        for (int i = 0; i < MAX; i++) {
            am.cancel(pending(ctx, BASE_CODE + i, "", ""));
        }
    }

    public static void schedule(Context ctx, String json) {
        cancelAlarms(ctx);
        try {
            JSONArray arr = new JSONArray(json);
            AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
            long now = System.currentTimeMillis();
            JSONArray kept = new JSONArray();
            for (int i = 0; i < arr.length() && kept.length() < MAX; i++) {
                JSONObject o = arr.getJSONObject(i);
                long at = o.getLong("at");
                if (at <= now) continue;
                am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at,
                        pending(ctx, BASE_CODE + kept.length(), o.getString("title"), o.getString("body")));
                kept.put(o);
            }
            prefs(ctx).edit().putString(KEY, kept.toString()).apply();
        } catch (Exception ignored) {
            // Ugyldig JSON: ingen alarmer settes.
        }
    }

    public static void cancel(Context ctx) {
        cancelAlarms(ctx);
        prefs(ctx).edit().remove(KEY).apply();
    }

    /** Settes opp igjen etter omstart av telefonen eller oppdatering av appen. */
    public static void reschedule(Context ctx) {
        String stored = prefs(ctx).getString(KEY, null);
        if (stored != null) schedule(ctx, stored);
    }

    public static void show(Context ctx, String title, String body) {
        if (Build.VERSION.SDK_INT >= 33
                && ctx.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)
                != PackageManager.PERMISSION_GRANTED) {
            return;
        }
        NotificationManager nm = ctx.getSystemService(NotificationManager.class);
        nm.createNotificationChannel(new NotificationChannel(
                CHANNEL, "Morning notification", NotificationManager.IMPORTANCE_DEFAULT));
        Intent open = new Intent(ctx, MainActivity.class)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent pi = PendingIntent.getActivity(ctx, 1, open,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        String first = body.contains("\n") ? body.substring(0, body.indexOf('\n')) : body;
        Notification n = new Notification.Builder(ctx, CHANNEL)
                .setSmallIcon(R.drawable.ic_stat_daybreak)
                .setContentTitle(title)
                .setContentText(first)
                .setStyle(new Notification.BigTextStyle().bigText(body))
                .setContentIntent(pi)
                .setAutoCancel(true)
                .build();
        nm.notify(1, n);
    }
}
