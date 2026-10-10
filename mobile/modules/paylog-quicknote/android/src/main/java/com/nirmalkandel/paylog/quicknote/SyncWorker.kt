package com.nirmalkandel.paylog.quicknote

import android.content.Context
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequest
import androidx.work.WorkManager
import androidx.work.Worker
import androidx.work.WorkerParameters
import org.json.JSONArray
import java.io.IOException
import java.util.concurrent.TimeUnit

/** Sends quick notes written offline as soon as the phone is back online, app open or not. */
class SyncWorker(context: Context, params: WorkerParameters) : Worker(context, params) {
  override fun doWork(): Result {
    val context = applicationContext
    val queue = Store.pending(context)
    if (queue.length() == 0) return Result.success()
    val left = JSONArray()
    var sent = 0
    var lastSaved: String? = null
    for (i in 0 until queue.length()) {
      val note = queue.getJSONObject(i)
      if (left.length() > 0) {
        left.put(note) // keep the order: once one fails, the rest wait too
        continue
      }
      try {
        val kind = if (note.has("kind")) note.getString("kind") else null
        lastSaved = Notes.describe(Api.quickAdd(context, note.getString("q"), note.getString("on"), kind))
        sent++
      } catch (e: IOException) {
        left.put(note)
      } catch (e: ApiException) {
        // 401: keep the notes until the app signs in again. Other errors (a note
        // the server can't read) can never succeed, so that note is dropped.
        if (e.status == 401) left.put(note)
      }
    }
    Store.setPending(context, left)
    if (sent > 0) {
      Store.setLastSaved(context, if (sent == 1 && lastSaved != null) lastSaved else "Synced $sent notes")
      Widgets.refresh(context)
    }
    return if (left.length() > 0 && runAttemptCount < 20) Result.retry() else Result.success()
  }

  companion object {
    private const val NAME = "paylog-quicknote-sync"

    fun schedule(context: Context) {
      val request = OneTimeWorkRequest.Builder(SyncWorker::class.java)
        .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
        .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
        .build()
      WorkManager.getInstance(context.applicationContext).enqueueUniqueWork(NAME, ExistingWorkPolicy.REPLACE, request)
    }
  }
}
