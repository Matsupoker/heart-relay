package jp.heartrelay.app

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.io.IOException
import java.util.concurrent.TimeUnit

class ApiException(message: String, val status: Int = 0) : IOException(message)

class ApiClient(private val baseUrlProvider: () -> String) {
    private val http = OkHttpClient.Builder()
        .connectTimeout(5, TimeUnit.SECONDS)
        .readTimeout(10, TimeUnit.SECONDS)
        .writeTimeout(10, TimeUnit.SECONDS)
        .build()

    private fun url(path: String): String {
        val base = baseUrlProvider().trim().trimEnd('/')
        return base + path
    }

    private suspend fun call(req: Request): String = withContext(Dispatchers.IO) {
        try {
            http.newCall(req).execute().use { res ->
                val text = res.body?.string().orEmpty()
                if (!res.isSuccessful) {
                    val msg = Json.errorMessage(text) ?: "HTTP ${res.code}"
                    throw ApiException(msg, res.code)
                }
                text
            }
        } catch (e: ApiException) {
            throw e
        } catch (e: IllegalArgumentException) {
            throw ApiException("サーバURLが正しくありません")
        } catch (e: IOException) {
            throw ApiException("サーバに接続できません (${e.message ?: e.javaClass.simpleName})")
        }
    }

    private fun get(path: String) = Request.Builder().url(url(path)).get().build()

    suspend fun health(): Health = Json.health(call(get("/api/health")))

    suspend fun staff(): List<Staff> = Json.staffList(call(get("/api/staff")))

    suspend fun deliveries(staffId: String): List<Delivery> =
        Json.deliveryList(call(get("/api/staff/$staffId/deliveries")))

    suspend fun ack(deliveryId: String, staffId: String): Delivery {
        val body = JSONObject().put("client", "android").toString()
            .toRequestBody("application/json; charset=utf-8".toMediaType())
        val req = Request.Builder()
            .url(url("/api/deliveries/$deliveryId/ack"))
            .header("X-Staff-Id", staffId)
            .post(body)
            .build()
        return Json.delivery(JSONObject(call(req)))
    }
}
