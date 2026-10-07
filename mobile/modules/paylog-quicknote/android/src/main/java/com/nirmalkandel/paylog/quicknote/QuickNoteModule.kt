package com.nirmalkandel.paylog.quicknote

import android.content.Context
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/** JS side: modules/paylog-quicknote/index.ts. */
class QuickNoteModule : Module() {
  private val context: Context
    get() = appContext.reactContext?.applicationContext ?: throw Exceptions.ReactContextLost()

  override fun definition() = ModuleDefinition {
    Name("PaylogQuickNote")

    /** Mirror the app's sign-in so the quick note can save while the app is closed. null = signed out. */
    Function("setSession") { apiUrl: String, token: String? ->
      Store.setSession(context, apiUrl, token)
      if (token != null && Store.pending(context).length() > 0) SyncWorker.schedule(context)
    }

    /** The last entry the quick note saved ("Saved ₹250 · Food"), once, for the widget. */
    Function("takeLastSaved") {
      Store.takeLastSaved(context)
    }

    Function("pendingCount") {
      Store.pending(context).length()
    }
  }
}
