package jp.heartrelay.app

import android.content.Context

const val DEFAULT_SERVER_URL = "http://10.0.2.2:8787"

class SettingsStore(context: Context) {
    private val sp = context.applicationContext.getSharedPreferences("heart_relay", Context.MODE_PRIVATE)

    var serverUrl: String
        get() = sp.getString("server_url", DEFAULT_SERVER_URL) ?: DEFAULT_SERVER_URL
        set(v) = sp.edit().putString("server_url", v).apply()

    var staffId: String?
        get() = sp.getString("staff_id", null)
        set(v) = sp.edit().putString("staff_id", v).apply()

    var staffName: String
        get() = sp.getString("staff_name", "") ?: ""
        set(v) = sp.edit().putString("staff_name", v).apply()

    var staffRole: String
        get() = sp.getString("staff_role", "") ?: ""
        set(v) = sp.edit().putString("staff_role", v).apply()

    /** 初回ポーリング済みの職員は null ではなく集合を返す。未初期化は null。 */
    fun seenIds(staffId: String): Set<String>? = sp.getStringSet("seen_$staffId", null)?.toSet()

    fun setSeenIds(staffId: String, ids: Set<String>) {
        sp.edit().putStringSet("seen_$staffId", ids).apply()
    }
}
