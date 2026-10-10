package com.nirmalkandel.paylog.quicknote

import android.content.Context
import android.content.SharedPreferences
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import org.json.JSONArray
import org.json.JSONObject
import java.security.KeyStore
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * What the quick note needs while React Native isn't running: the server URL and
 * sign-in token (mirrored here by the app; the token is encrypted with a key that
 * never leaves the Android Keystore), notes waiting for the network, the unsent
 * draft, and the last saved entry for the widget.
 */
internal object Store {
  private const val PREFS = "paylog_quicknote"
  private const val KEY_ALIAS = "paylog_quicknote_token"
  private const val MAX_PENDING = 50

  private fun prefs(context: Context): SharedPreferences =
    context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

  // ---- Session --------------------------------------------------------------

  fun setSession(context: Context, apiUrl: String, token: String?) {
    val p = prefs(context)
    if (token == null) {
      // Signed out: forget everything that belonged to that account.
      p.edit().clear().putString("api_url", apiUrl).apply()
      return
    }
    if (token == token(context) && apiUrl == p.getString("api_url", null)) return
    p.edit().putString("api_url", apiUrl).putString("token", encrypt(token)).apply()
  }

  fun apiUrl(context: Context): String? = prefs(context).getString("api_url", null)

  fun token(context: Context): String? {
    val stored = prefs(context).getString("token", null) ?: return null
    return try {
      decrypt(stored)
    } catch (e: Exception) {
      null // key lost (e.g. restored device): the app mirrors the token again on next open
    }
  }

  // ---- Notes waiting for the network ----------------------------------------

  /** Each pending note keeps the day it was written so "yesterday" stays right. */
  fun enqueue(context: Context, lines: List<String>, writtenOn: String, kind: String?) {
    val queue = pending(context)
    for (line in lines) {
      if (queue.length() >= MAX_PENDING) break
      val note = JSONObject().put("q", line).put("on", writtenOn)
      if (kind != null) note.put("kind", kind) // the − / + chosen on the card
      queue.put(note)
    }
    prefs(context).edit().putString("pending", queue.toString()).apply()
  }

  fun pending(context: Context): JSONArray =
    try {
      JSONArray(prefs(context).getString("pending", "[]"))
    } catch (e: Exception) {
      JSONArray()
    }

  fun setPending(context: Context, queue: JSONArray) {
    prefs(context).edit().putString("pending", queue.toString()).apply()
  }

  // ---- Draft and last saved -------------------------------------------------

  fun draft(context: Context): String = prefs(context).getString("draft", "") ?: ""

  fun setDraft(context: Context, text: String) {
    prefs(context).edit().putString("draft", text).apply()
  }

  fun setLastSaved(context: Context, text: String) {
    prefs(context).edit().putString("last_saved", text).apply()
  }

  /** The widget's "Saved ₹250 · Food" line, handed to the JS widget renderer once. */
  fun takeLastSaved(context: Context): String? {
    val p = prefs(context)
    val value = p.getString("last_saved", null) ?: return null
    p.edit().remove("last_saved").apply()
    return value
  }

  fun today(): String = SimpleDateFormat("yyyy-MM-dd", Locale.US).format(Date())

  // ---- Keystore encryption --------------------------------------------------

  private fun key(): SecretKey {
    val keyStore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
    (keyStore.getKey(KEY_ALIAS, null) as? SecretKey)?.let { return it }
    val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
    generator.init(
      KeyGenParameterSpec.Builder(KEY_ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
        .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
        .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
        .build(),
    )
    return generator.generateKey()
  }

  private fun encrypt(plain: String): String {
    val cipher = Cipher.getInstance("AES/GCM/NoPadding")
    cipher.init(Cipher.ENCRYPT_MODE, key())
    val sealed = cipher.doFinal(plain.toByteArray(Charsets.UTF_8))
    return b64(cipher.iv) + ":" + b64(sealed)
  }

  private fun decrypt(stored: String): String {
    val (iv, sealed) = stored.split(":", limit = 2)
    val cipher = Cipher.getInstance("AES/GCM/NoPadding")
    cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, unb64(iv)))
    return String(cipher.doFinal(unb64(sealed)), Charsets.UTF_8)
  }

  private fun b64(bytes: ByteArray) = Base64.encodeToString(bytes, Base64.NO_WRAP)

  private fun unb64(text: String) = Base64.decode(text, Base64.NO_WRAP)
}
