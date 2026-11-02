package jp.heartrelay.app

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat

const val EXTRA_DELIVERY_ID = "delivery_id"
private const val CHANNEL_ID = "deliveries"

class Notifier(context: Context) {
    private val ctx = context.applicationContext

    fun ensureChannel() {
        if (Build.VERSION.SDK_INT >= 26) {
            val ch = NotificationChannel(CHANNEL_ID, "連絡事項", NotificationManager.IMPORTANCE_HIGH)
            ch.description = "あなた宛ての連絡事項"
            ctx.getSystemService(NotificationManager::class.java).createNotificationChannel(ch)
        }
    }

    fun notify(d: Delivery) {
        if (Build.VERSION.SDK_INT >= 33 &&
            ContextCompat.checkSelfPermission(ctx, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) return
        val intent = Intent(ctx, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP
            putExtra(EXTRA_DELIVERY_ID, d.id)
        }
        val pi = PendingIntent.getActivity(
            ctx, d.id.hashCode(), intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        val n = NotificationCompat.Builder(ctx, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat)
            .setContentTitle(d.title)
            .setContentText(d.body)
            .setStyle(NotificationCompat.BigTextStyle().bigText(d.body))
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setAutoCancel(true)
            .setContentIntent(pi)
            .build()
        try {
            NotificationManagerCompat.from(ctx).notify(d.id.hashCode(), n)
        } catch (_: SecurityException) {
        }
    }

    fun cancel(deliveryId: String) {
        NotificationManagerCompat.from(ctx).cancel(deliveryId.hashCode())
    }
}
