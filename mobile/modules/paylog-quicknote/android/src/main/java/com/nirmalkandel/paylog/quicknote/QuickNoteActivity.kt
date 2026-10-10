package com.nirmalkandel.paylog.quicknote

import android.app.Activity
import android.content.Intent
import android.content.res.Configuration
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.text.Editable
import android.text.InputType
import android.text.TextWatcher
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.ViewGroup.LayoutParams.MATCH_PARENT
import android.view.ViewGroup.LayoutParams.WRAP_CONTENT
import android.view.WindowInsets
import android.view.inputmethod.InputMethodManager
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import java.io.IOException
import java.util.concurrent.Executors

/**
 * The widget's quick note: a card that slides up over the home screen with the
 * keyboard open, like jotting in a notes app. "250 lunch" + Save sends it
 * straight to the server (no app start), shows "Saved ₹250 · Food" with Undo,
 * and closes itself. Offline, notes wait on the phone and SyncWorker sends them
 * later. Anything typed but not saved stays as a draft for next time.
 */
class QuickNoteActivity : Activity() {
  private val main = Handler(Looper.getMainLooper())
  private val io = Executors.newFixedThreadPool(2)
  private lateinit var colors: Palette
  private lateinit var input: EditText
  private lateinit var preview: TextView
  private lateinit var status: TextView
  private lateinit var footer: TextView
  private lateinit var primary: TextView
  private lateinit var secondary: TextView
  private lateinit var debitButton: TextView
  private lateinit var creditButton: TextView

  /** The − / + switch: "expense", "income", or null = decide from the words ("salary 65000"). */
  private var kind: String? = null
  private var saving = false
  private var savedIds: List<Long> = emptyList()
  private var savedText = ""
  private var previewSeq = 0
  private val runPreview = Runnable { preview() }
  private val autoClose = Runnable { finish() }

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    val night = resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK == Configuration.UI_MODE_NIGHT_YES
    colors = Palette.of(night)
    setContentView(buildViews())
    paintKind()

    input.setText(Store.draft(this))
    input.setSelection(input.text.length)
    if (Store.token(this) == null) showSignedOut()
    showPending()
    if (Store.pending(this).length() > 0) SyncWorker.schedule(this)
  }

  override fun onResume() {
    super.onResume()
    if (Store.token(this) != null) focusInput()
  }

  override fun onNewIntent(intent: Intent?) {
    super.onNewIntent(intent)
    main.removeCallbacks(autoClose)
    focusInput()
  }

  override fun onPause() {
    super.onPause()
    // Like a notes app: whatever is typed but not saved is there next time.
    Store.setDraft(this, input.text.toString())
  }

  override fun onDestroy() {
    main.removeCallbacksAndMessages(null)
    io.shutdown()
    super.onDestroy()
  }

  // ---- Saving -------------------------------------------------------------------

  private fun save() {
    if (saving) return
    val lines = Notes.lines(input.text.toString())
    if (lines.isEmpty()) {
      say("Type something like “250 lunch”.", colors.warning)
      return
    }
    saving = true
    primary.text = "Saving…"
    primary.isEnabled = false
    val writtenOn = Store.today()
    val chosen = kind
    io.execute {
      val ids = mutableListOf<Long>()
      var last: String? = null
      var outcome = Outcome.SAVED
      var message = ""
      var left = emptyList<String>()
      for ((i, line) in lines.withIndex()) {
        try {
          val res = Api.quickAdd(this, line, writtenOn, chosen)
          res.optJSONObject("transaction")?.optLong("id")?.let { ids += it }
          last = Notes.describe(res)
        } catch (e: IOException) {
          // No internet: keep the rest on the phone and send them later.
          Store.enqueue(this, lines.drop(i), writtenOn, chosen)
          SyncWorker.schedule(this)
          outcome = Outcome.QUEUED
          break
        } catch (e: ApiException) {
          outcome = if (e.status == 401) Outcome.SIGNED_OUT else Outcome.REJECTED
          message = if (e.status == 401) e.message.orEmpty() else "“$line”: ${e.message}"
          left = lines.drop(i)
          break
        }
      }
      val summary = if (ids.size == 1 && last != null) last else "Saved ${ids.size} entries"
      if (ids.isNotEmpty()) {
        Store.setLastSaved(this, summary)
        Widgets.refresh(this)
      }
      main.post {
        if (isFinishing || isDestroyed) return@post
        saving = false
        primary.isEnabled = true
        primary.text = "Save"
        savedIds = ids
        savedText = lines.take(ids.size).joinToString("\n")
        when (outcome) {
          Outcome.SAVED -> {
            input.setText("")
            say(summary, colors.good)
            showUndo()
            main.postDelayed(autoClose, 2500)
          }
          Outcome.QUEUED -> {
            input.setText("")
            say("No internet, so it's saved on your phone. Paylog adds it as soon as you're back online.", colors.good)
            showPending()
            main.postDelayed(autoClose, 2500)
          }
          Outcome.REJECTED, Outcome.SIGNED_OUT -> {
            // Saved lines are gone from the box; what's left stays to fix.
            input.setText(left.joinToString("\n"))
            input.setSelection(input.text.length)
            say(if (ids.isEmpty()) message else "$summary. $message", colors.warning)
            if (ids.isNotEmpty()) showUndo()
            if (outcome == Outcome.SIGNED_OUT) showSignedOut()
          }
        }
      }
    }
  }

  private fun undo() {
    val ids = savedIds
    if (ids.isEmpty()) return
    main.removeCallbacks(autoClose)
    secondary.isEnabled = false
    io.execute {
      val error = try {
        ids.forEach { Api.delete(this, it) }
        null
      } catch (e: Exception) {
        if (e is IOException) "Can't reach Paylog, so it wasn't undone." else e.message
      }
      if (error == null) Widgets.refresh(this)
      main.post {
        if (isFinishing || isDestroyed) return@post
        secondary.isEnabled = true
        if (error != null) {
          say(error, colors.warning)
          return@post
        }
        savedIds = emptyList()
        input.setText(savedText) // back in the box, ready to fix
        input.setSelection(input.text.length)
        say("Removed. Fix it and save again, or close.", colors.muted)
        showOpenApp()
        focusInput()
      }
    }
  }

  // ---- Live preview -------------------------------------------------------------

  private fun preview() {
    val lines = Notes.lines(input.text.toString())
    val line = lines.lastOrNull()
    val seq = ++previewSeq
    if (line == null || Store.token(this) == null) {
      preview.text = ""
      return
    }
    val chosen = kind
    io.execute {
      val (text, ok) = try {
        val res = Api.preview(this, line, chosen)
        if (res.optBoolean("ok")) {
          val direction = if (res.optString("kind") == "income") "+ Credit" else "− Debit"
          val parts = listOf("$direction ${res.optString("amount")}", res.optString("category"),
            res.optString("description"), res.optString("when")).filter { it.isNotBlank() }
          parts.joinToString(" · ") to true
        } else {
          res.optString("error") to false
        }
      } catch (e: Exception) {
        "" to true // offline: no preview, saving still works
      }
      main.post {
        if (seq != previewSeq || isFinishing || isDestroyed) return@post
        val prefix = if (lines.size > 1) "${lines.size} entries · last: " else ""
        preview.text = if (text.isBlank()) "" else (if (ok) "✓ " else "! ") + prefix + text
        preview.setTextColor(if (ok) colors.muted else colors.warning)
      }
    }
  }

  // ---- − / + switch -------------------------------------------------------------

  /** Tap a side to force it; tap it again to let the words decide. */
  private fun chooseKind(value: String) {
    kind = if (kind == value) null else value
    paintKind()
    main.removeCallbacks(runPreview)
    preview()
  }

  private fun paintKind() {
    for ((view, value, tint) in listOf(Triple(debitButton, "expense", colors.debit), Triple(creditButton, "income", colors.credit))) {
      val on = kind == value
      view.background = rounded(if (on) tint else colors.chip, 14f)
      view.setTextColor(if (on) Color.WHITE else colors.ink)
      view.contentDescription = (if (value == "income") "Credit, money received" else "Debit, money paid") +
        if (on) ", selected" else ""
    }
  }

  // ---- States -------------------------------------------------------------------

  private fun say(text: String, color: Int) {
    status.text = text
    status.setTextColor(color)
    status.visibility = View.VISIBLE
  }

  private fun showUndo() {
    secondary.text = "Undo"
    secondary.setOnClickListener { undo() }
  }

  private fun showOpenApp() {
    secondary.text = "Open app"
    secondary.setOnClickListener { openApp() }
  }

  private fun showSignedOut() {
    say("Sign in to Paylog once, then the quick note works from your home screen.", colors.muted)
    primary.text = "Open Paylog"
    primary.setOnClickListener { openApp() }
    secondary.visibility = View.GONE
  }

  private fun showPending() {
    val count = Store.pending(this).length()
    footer.text = when (count) {
      0 -> ""
      1 -> "1 note waiting for internet"
      else -> "$count notes waiting for internet"
    }
    footer.visibility = if (count == 0) View.GONE else View.VISIBLE
  }

  private fun openApp() {
    Store.setDraft(this, input.text.toString())
    packageManager.getLaunchIntentForPackage(packageName)?.let {
      startActivity(it.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    }
    finish()
  }

  private fun focusInput() {
    input.requestFocus()
    main.postDelayed({
      (getSystemService(INPUT_METHOD_SERVICE) as InputMethodManager).showSoftInput(input, InputMethodManager.SHOW_IMPLICIT)
    }, 150)
  }

  // ---- Views --------------------------------------------------------------------

  private fun buildViews(): View {
    val root = FrameLayout(this).apply {
      setBackgroundColor(colors.scrim)
      setOnClickListener { finish() } // tap outside the card to close (the draft is kept)
    }

    val card = LinearLayout(this).apply {
      orientation = LinearLayout.VERTICAL
      background = rounded(colors.paper, 22f)
      setPadding(dp(18), dp(14), dp(18), dp(14))
      isClickable = true // taps on the card don't reach the scrim
      elevation = dp(8).toFloat()
    }

    val header = LinearLayout(this).apply {
      orientation = LinearLayout.HORIZONTAL
      gravity = Gravity.CENTER_VERTICAL
    }
    header.addView(text("Paylog quick note", 14f, colors.accent, bold = true), LinearLayout.LayoutParams(0, WRAP_CONTENT, 1f))
    header.addView(text("✕", 18f, colors.muted).apply {
      contentDescription = "Close"
      setPadding(dp(10), dp(4), dp(4), dp(4))
      setOnClickListener { finish() }
    })
    card.addView(header)

    // − Debit / + Credit. Untouched, the words decide ("salary 65000" is a credit).
    val direction = LinearLayout(this).apply {
      orientation = LinearLayout.HORIZONTAL
      setPadding(0, dp(10), 0, dp(2))
    }
    debitButton = button("−  Debit", filled = false).apply { setOnClickListener { chooseKind("expense") } }
    creditButton = button("+  Credit", filled = false).apply { setOnClickListener { chooseKind("income") } }
    direction.addView(debitButton, LinearLayout.LayoutParams(0, WRAP_CONTENT, 1f).apply { marginEnd = dp(8) })
    direction.addView(creditButton, LinearLayout.LayoutParams(0, WRAP_CONTENT, 1f))
    debitButton.gravity = Gravity.CENTER
    creditButton.gravity = Gravity.CENTER
    card.addView(direction, LinearLayout.LayoutParams(MATCH_PARENT, WRAP_CONTENT))

    input = EditText(this).apply {
      hint = "250 lunch\n+1200 from Rahul"
      setHintTextColor(colors.faint)
      setTextColor(colors.ink)
      setTextSize(TypedValue.COMPLEX_UNIT_SP, 21f)
      background = null
      setPadding(0, dp(8), 0, dp(8))
      gravity = Gravity.TOP or Gravity.START
      inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_MULTI_LINE or InputType.TYPE_TEXT_FLAG_CAP_SENTENCES
      minLines = 2
      maxLines = 6
      contentDescription = "Quick note. One transaction per line."
      addTextChangedListener(object : TextWatcher {
        override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) {}
        override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) {}
        override fun afterTextChanged(s: Editable?) {
          main.removeCallbacks(runPreview)
          main.postDelayed(runPreview, 400)
        }
      })
    }
    card.addView(input, LinearLayout.LayoutParams(MATCH_PARENT, WRAP_CONTENT))

    preview = text("e.g. 250 lunch · 2k rent yesterday · salary 65000", 13f, colors.muted)
    card.addView(preview)

    status = text("", 14f, colors.ink).apply {
      visibility = View.GONE
      setPadding(0, dp(8), 0, 0)
    }
    card.addView(status)

    val buttons = LinearLayout(this).apply {
      orientation = LinearLayout.HORIZONTAL
      gravity = Gravity.CENTER_VERTICAL
      setPadding(0, dp(12), 0, 0)
    }
    secondary = button("Open app", filled = false).apply { setOnClickListener { openApp() } }
    buttons.addView(secondary)
    buttons.addView(View(this), LinearLayout.LayoutParams(0, 1, 1f))
    primary = button("Save", filled = true).apply { setOnClickListener { save() } }
    buttons.addView(primary)
    card.addView(buttons)

    footer = text("", 12f, colors.muted).apply { setPadding(0, dp(8), 0, 0) }
    card.addView(footer)

    root.addView(card, FrameLayout.LayoutParams(MATCH_PARENT, WRAP_CONTENT, Gravity.BOTTOM).apply {
      setMargins(dp(10), dp(10), dp(10), dp(10))
    })

    // Keep the card just above the keyboard. Android 11+: handle the insets
    // ourselves (edge-to-edge); older versions resize the window (adjustResize).
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
      window.setDecorFitsSystemWindows(false)
      root.setOnApplyWindowInsetsListener { view, insets ->
        val bars = insets.getInsets(WindowInsets.Type.systemBars())
        val ime = insets.getInsets(WindowInsets.Type.ime())
        view.setPadding(0, bars.top, 0, maxOf(bars.bottom, ime.bottom))
        insets
      }
    }
    return root
  }

  private fun text(value: String, size: Float, color: Int, bold: Boolean = false) = TextView(this).apply {
    text = value
    setTextSize(TypedValue.COMPLEX_UNIT_SP, size)
    setTextColor(color)
    if (bold) typeface = Typeface.DEFAULT_BOLD
  }

  private fun button(label: String, filled: Boolean) = text(label, 15f, if (filled) colors.onAccent else colors.accent, bold = true).apply {
    background = rounded(if (filled) colors.accent else colors.chip, 14f)
    setPadding(dp(18), dp(10), dp(18), dp(10))
    isClickable = true
    isFocusable = true
  }

  private fun rounded(color: Int, radiusDp: Float) = GradientDrawable().apply {
    setColor(color)
    cornerRadius = dp(radiusDp.toInt()).toFloat()
  }

  private fun dp(value: Int) = (value * resources.displayMetrics.density).toInt()

  private enum class Outcome { SAVED, QUEUED, REJECTED, SIGNED_OUT }

  /** Same colours as the widget (src/widgets/QuickNoteWidget.tsx). */
  private data class Palette(
    val paper: Int, val ink: Int, val muted: Int, val faint: Int, val accent: Int, val onAccent: Int,
    val chip: Int, val good: Int, val warning: Int, val scrim: Int, val debit: Int, val credit: Int,
  ) {
    companion object {
      fun of(dark: Boolean) = if (dark) {
        Palette(c("#1f201e"), c("#f3f1ec"), c("#a5a29a"), c("#6f6c65"), c("#5fb3a9"), c("#0d1f1c"),
          c("#2b3b38"), c("#7cc4a0"), c("#e0a35a"), c("#66000000"), c("#c2410c"), c("#1d7a4f"))
      } else {
        Palette(c("#fbf8f1"), c("#141413"), c("#6b6962"), c("#a9a69e"), c("#0e5e56"), c("#ffffff"),
          c("#e3efec"), c("#1d7a4f"), c("#a3570f"), c("#4d000000"), c("#c2410c"), c("#0f7a2e"))
      }

      private fun c(hex: String) = Color.parseColor(hex)
    }
  }
}
