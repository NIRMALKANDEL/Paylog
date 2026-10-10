package com.nirmalkandel.paylog.quicknote

import android.content.Context
import org.json.JSONObject
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder

/** The server said no (bad note, signed out, ...). Network trouble is an IOException instead. */
internal class ApiException(val status: Int, message: String) : Exception(message)

/** The few Paylog API calls the quick note makes, with the app's saved sign-in. */
internal object Api {
  private const val TIMEOUT_MS = 15_000

  /**
   * One line ("250 lunch") -> saved transaction. Same endpoint the app uses.
   * `kind` ("expense" / "income") is the card's − / + switch; null lets the words decide.
   */
  fun quickAdd(context: Context, line: String, writtenOn: String, kind: String?): JSONObject {
    val body = JSONObject().put("q", line).put("written_on", writtenOn)
    if (kind != null) body.put("kind", kind)
    return call(context, "POST", "/transactions/quick", body)
  }

  fun preview(context: Context, line: String, kind: String?): JSONObject =
    call(context, "GET", "/transactions/quick/preview?q=" + URLEncoder.encode(line, "UTF-8") +
      (if (kind != null) "&kind=$kind" else ""), null)

  fun delete(context: Context, id: Long) {
    call(context, "DELETE", "/transactions/$id", null)
  }

  private fun call(context: Context, method: String, path: String, body: JSONObject?): JSONObject {
    val base = Store.apiUrl(context) ?: throw ApiException(401, "Open Paylog and sign in first.")
    val token = Store.token(context) ?: throw ApiException(401, "Open Paylog and sign in first.")
    val conn = URL("$base/api/v1$path").openConnection() as HttpURLConnection
    try {
      conn.requestMethod = method
      conn.connectTimeout = TIMEOUT_MS
      conn.readTimeout = TIMEOUT_MS
      conn.setRequestProperty("Accept", "application/json")
      conn.setRequestProperty("Authorization", "Bearer $token")
      if (body != null) {
        conn.doOutput = true
        conn.setRequestProperty("Content-Type", "application/json")
        conn.outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }
      }
      val status = conn.responseCode
      val stream = if (status < 400) conn.inputStream else conn.errorStream
      val text = stream?.bufferedReader()?.use { it.readText() }.orEmpty()
      val json = try {
        JSONObject(text)
      } catch (e: Exception) {
        JSONObject()
      }
      if (status >= 400) {
        val fallback = if (status == 401) "Your sign-in has expired. Open Paylog to sign in again." else "Something went wrong ($status)."
        throw ApiException(status, json.optString("error").ifBlank { fallback })
      }
      return json
    } catch (e: IOException) {
      throw IOException("Can't reach Paylog.", e)
    } finally {
      conn.disconnect()
    }
  }
}
