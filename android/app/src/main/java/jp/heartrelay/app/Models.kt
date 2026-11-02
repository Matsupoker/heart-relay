package jp.heartrelay.app

import org.json.JSONArray
import org.json.JSONObject
import java.time.Instant
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter

data class Staff(
    val id: String,
    val name: String,
    val role: String,
    val duties: List<String>,
    val active: Boolean,
)

data class Delivery(
    val id: String,
    val messageId: String,
    val staffId: String,
    val staffName: String,
    val staffRole: String,
    val title: String,
    val body: String,
    val actionRequired: String,
    val reason: String,
    val urgency: String,
    val categories: List<String>,
    val createdAt: String,
    val acknowledgedAt: String?,
) {
    val isAcknowledged: Boolean get() = acknowledgedAt != null
}

data class Health(val ok: Boolean, val analyzer: String?, val model: String?, val time: String?)

/** 職種の表示順 (api.md の Role 定義順)。 */
val ROLE_ORDER = listOf("事業所長", "生活相談員", "看護師", "理学療法士", "介護職員", "運転手")

object Json {
    private fun JSONObject.optStr(key: String): String? =
        if (isNull(key) || !has(key)) null else optString(key)

    private fun JSONObject.strList(key: String): List<String> {
        val arr = optJSONArray(key) ?: return emptyList()
        return (0 until arr.length()).map { arr.optString(it) }
    }

    fun staff(o: JSONObject) = Staff(
        id = o.getString("id"),
        name = o.optString("name"),
        role = o.optString("role"),
        duties = o.strList("duties"),
        active = o.optBoolean("active", true),
    )

    fun staffList(text: String): List<Staff> {
        val arr = JSONArray(text)
        return (0 until arr.length()).map { staff(arr.getJSONObject(it)) }
    }

    fun delivery(o: JSONObject) = Delivery(
        id = o.getString("id"),
        messageId = o.optString("message_id"),
        staffId = o.optString("staff_id"),
        staffName = o.optString("staff_name"),
        staffRole = o.optString("staff_role"),
        title = o.optString("title"),
        body = o.optString("body"),
        actionRequired = o.optString("action_required"),
        reason = o.optString("reason"),
        urgency = o.optString("urgency", "low"),
        categories = o.strList("categories"),
        createdAt = o.optString("created_at"),
        acknowledgedAt = o.optStr("acknowledged_at"),
    )

    fun deliveryList(text: String): List<Delivery> {
        val arr = JSONArray(text)
        return (0 until arr.length()).map { delivery(arr.getJSONObject(it)) }
    }

    fun health(text: String): Health {
        val o = JSONObject(text)
        return Health(o.optBoolean("ok"), o.optStr("analyzer"), o.optStr("model"), o.optStr("time"))
    }

    fun errorMessage(text: String): String? = try {
        JSONObject(text).optStr("error")
    } catch (e: Exception) {
        null
    }
}

object TimeFmt {
    val JST: ZoneId = ZoneId.of("Asia/Tokyo")
    private val hm = DateTimeFormatter.ofPattern("HH:mm").withZone(JST)

    fun parse(iso: String): Instant? = try {
        Instant.parse(iso)
    } catch (e: Exception) {
        try {
            OffsetDateTime.parse(iso).toInstant()
        } catch (e2: Exception) {
            null
        }
    }

    /** ISO-8601 を JST の HH:mm に。パース不能なら "--:--"。 */
    fun hhmm(iso: String?): String = iso?.let { parse(it) }?.let { hm.format(it) } ?: "--:--"
}

object DeliveryLogic {
    /** 未確認を先、同じ区分では新しい順。 */
    fun sortInbox(list: List<Delivery>): List<Delivery> =
        list.sortedWith(
            compareBy<Delivery> { it.isAcknowledged }
                .thenByDescending { TimeFmt.parse(it.createdAt)?.toEpochMilli() ?: 0L }
        )

    /** 未確認かつ、これまで見ていない配信。 */
    fun newUnseen(list: List<Delivery>, seen: Set<String>): List<Delivery> =
        list.filter { !it.isAcknowledged && it.id !in seen }
}
