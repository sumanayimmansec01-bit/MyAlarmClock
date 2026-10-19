package com.myalarmclock.timer

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.text.InputType
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.ViewGroup.LayoutParams.MATCH_PARENT
import android.view.ViewGroup.LayoutParams.WRAP_CONTENT
import android.view.WindowInsets
import android.view.inputmethod.EditorInfo
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.RadioButton
import android.widget.RadioGroup
import android.widget.ScrollView
import android.widget.SeekBar
import android.widget.Switch
import android.widget.TextView

/**
 * Black, low-glare screen for meditation. The display only ticks while it is
 * visible; once the screen is off the system alarm does all the work.
 */
class MainActivity : Activity() {
    private object C {
        const val BG = 0xFF000000.toInt()
        const val SURFACE = 0xFF11151B.toInt()
        const val LINE = 0xFF27303B.toInt()
        const val FG = 0xFFE3E8EF.toInt()
        const val MUTED = 0xFF8995A3.toInt()
        const val ACCENT = 0xFF3F6FE0.toInt()
        const val PAUSE = 0xFFB8660C.toInt()
        const val RESUME = 0xFF2E8A5A.toInt()
        const val DONE = 0xFF5CC58F.toInt()
        const val DANGER = 0xFFFF8A7A.toInt()
        const val WARN_BG = 0xFF2A1F0C.toInt()
    }

    private lateinit var store: Store
    private val handler = Handler(Looper.getMainLooper())
    private var roundsKey = ""

    private lateinit var timeText: TextView
    private lateinit var roundText: TextView
    private lateinit var endText: TextView
    private lateinit var startBtn: Button
    private lateinit var resetBtn: Button
    private lateinit var warning: TextView
    private lateinit var totalText: TextView
    private lateinit var roundList: LinearLayout
    private lateinit var editArea: LinearLayout
    private lateinit var input: EditText
    private lateinit var inputError: TextView

    private val tick = object : Runnable {
        override fun run() {
            render()
            val now = System.currentTimeMillis()
            handler.postDelayed(this, 1000 - now % 1000 + 20)
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        store = Store(this)
        Notifier.channels(this)
        window.statusBarColor = C.BG
        window.navigationBarColor = C.BG
        setContentView(build())
    }

    override fun onStart() {
        super.onStart()
        TimerEngine.restore(this) // re-arms if the system dropped the alarm
        handler.post(tick)
    }

    override fun onStop() {
        handler.removeCallbacks(tick)
        super.onStop()
    }

    // ---------- actions ----------

    private fun onMainButton() {
        when (store.status) {
            Status.RUNNING -> TimerEngine.pause(this)
            Status.PAUSED -> TimerEngine.resume(this)
            else -> {
                if (store.rounds.isEmpty()) return
                askForNotifications()
                TimerEngine.start(this)
            }
        }
        render()
    }

    private fun editRounds(change: (MutableList<Int>) -> Unit) {
        val status = store.status
        if (status == Status.RUNNING || status == Status.PAUSED) return
        val list = store.rounds.toMutableList()
        change(list)
        store.rounds = list
        if (status == Status.FINISHED) TimerEngine.reset(this)
        render()
    }

    private fun addTyped() {
        val values = Plan.parseList(input.text.toString())
        if (values == null) {
            if (input.text.isNotBlank()) {
                inputError.text = "ใส่เป็นตัวเลขนาที เช่น 40 หรือ 40, 40 หรือ 1:30 (นาที:วินาที)"
                inputError.visibility = View.VISIBLE
            }
            return
        }
        inputError.visibility = View.GONE
        input.setText("")
        editRounds { it.addAll(values) }
    }

    private fun askForNotifications() {
        if (Build.VERSION.SDK_INT >= 33 && !Notifier.canPost(this)) {
            requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 1)
        }
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        Notifier.show(this)
        render()
    }

    // ---------- render ----------

    private fun render() {
        val status = store.status
        val now = System.currentTimeMillis()
        val run = store.runRounds
        val rounds = store.rounds

        val remainingMs = when (status) {
            Status.RUNNING -> maxOf(0L, store.endAt - now)
            Status.PAUSED -> store.remainingMs
            Status.FINISHED -> 0L
            Status.IDLE -> (rounds.firstOrNull() ?: 0) * 1000L
        }
        timeText.text = Plan.clock((remainingMs + 999) / 1000)
        timeText.setTextColor(if (status == Status.FINISHED) C.DONE else C.FG)

        roundText.text = when (status) {
            Status.IDLE -> if (rounds.isEmpty()) "ยังไม่ได้ตั้งรอบ" else "พร้อมเริ่ม • ${rounds.size} รอบ"
            Status.FINISHED -> "ครบทุกรอบแล้ว"
            Status.RUNNING -> "รอบ ${store.idx + 1} จาก ${run.size}"
            Status.PAUSED -> "รอบ ${store.idx + 1} จาก ${run.size} • หยุดชั่วคราว"
        }
        endText.text = when (status) {
            Status.RUNNING -> {
                val rest = run.drop(store.idx + 1).sum() * 1000L
                if (rest > 0) "รอบนี้ครบ ${Notifier.clock(store.endAt)} • ทั้งหมด ${Notifier.clock(store.endAt + rest)}"
                else "ครบเวลา ${Notifier.clock(store.endAt)}"
            }
            Status.FINISHED -> "หยุดเองแล้ว ไม่ต้องกดอะไร"
            else -> ""
        }

        val (label, color) = when (status) {
            Status.RUNNING -> "หยุดชั่วคราว" to C.PAUSE
            Status.PAUSED -> "ทำต่อ" to C.RESUME
            Status.FINISHED -> "เริ่มใหม่" to C.ACCENT
            Status.IDLE -> "เริ่ม" to C.ACCENT
        }
        startBtn.text = label
        startBtn.background = rounded(color, 18f)
        startBtn.isEnabled = rounds.isNotEmpty() || status == Status.RUNNING || status == Status.PAUSED
        startBtn.alpha = if (startBtn.isEnabled) 1f else 0.4f
        resetBtn.isEnabled = status != Status.IDLE
        resetBtn.alpha = if (resetBtn.isEnabled) 1f else 0.4f

        val locked = status == Status.RUNNING || status == Status.PAUSED
        editArea.alpha = if (locked) 0.4f else 1f
        setEnabledDeep(editArea, !locked)

        val shown = if (locked) run else rounds
        val key = "$status|${store.idx}|${shown.joinToString(",")}"
        if (key != roundsKey) {
            roundsKey = key
            renderRounds(shown, status, locked)
        }
        totalText.text = if (shown.isEmpty()) "" else "${shown.size} รอบ • รวม ${Plan.clock(shown.sum().toLong())}"

        val problems = buildList {
            if (!TimerEngine.canRingExactly(this@MainActivity)) add("ยังไม่ได้อนุญาต \"นาฬิกาปลุกและการแจ้งเตือน\" เสียงอาจดังช้ากว่ากำหนด แตะเพื่อเปิดการตั้งค่า")
            if (!Notifier.canPost(this@MainActivity)) add("ปิดการแจ้งเตือนไว้ จะไม่เห็นเวลาที่หน้าจอล็อก (เสียงเตือนยังดังตามปกติ)")
        }
        warning.text = problems.joinToString("\n\n")
        warning.visibility = if (problems.isEmpty()) View.GONE else View.VISIBLE
    }

    private fun renderRounds(list: List<Int>, status: Status, locked: Boolean) {
        roundList.removeAllViews()
        if (list.isEmpty()) {
            roundList.addView(text("ยังไม่มีรอบ แตะปุ่มนาทีด้านล่างเพื่อเพิ่ม", 15f, C.MUTED))
            return
        }
        list.forEachIndexed { i, sec ->
            val done = status == Status.FINISHED || (locked && i < store.idx)
            val current = locked && i == store.idx
            val row = LinearLayout(this).apply {
                orientation = LinearLayout.HORIZONTAL
                gravity = Gravity.CENTER_VERTICAL
                setPadding(dp(14), dp(10), dp(10), dp(10))
                background = rounded(if (current) 0xFF16233F.toInt() else C.SURFACE, 14f, if (current) C.ACCENT else C.LINE)
            }
            row.addView(text("รอบ ${i + 1}" + if (done) " ✓" else "", 14f, if (done) C.DONE else C.MUTED), LinearLayout.LayoutParams(dp(72), WRAP_CONTENT))
            row.addView(text(Plan.roundLabel(sec), 20f, if (done) C.MUTED else C.FG).apply {
                typeface = Typeface.DEFAULT_BOLD
                if (done) paintFlags = paintFlags or android.graphics.Paint.STRIKE_THRU_TEXT_FLAG
            }, LinearLayout.LayoutParams(0, WRAP_CONTENT, 1f))
            if (!locked) {
                row.addView(Button(this).apply {
                    text = "ลบ"
                    contentDescription = "ลบรอบ ${i + 1}"
                    style(this, 14f, C.DANGER)
                    background = rounded(Color.TRANSPARENT, 10f, C.DANGER)
                    minHeight = dp(40); minimumHeight = dp(40); minWidth = dp(56); minimumWidth = dp(56)
                    setOnClickListener { editRounds { it.removeAt(i) } }
                }, LinearLayout.LayoutParams(WRAP_CONTENT, dp(40)))
            }
            roundList.addView(row, LinearLayout.LayoutParams(MATCH_PARENT, WRAP_CONTENT).apply { bottomMargin = dp(8) })
        }
    }

    // ---------- layout ----------

    private fun build(): View {
        val col = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(18), dp(16), dp(18), dp(32))
        }
        val scroll = ScrollView(this).apply {
            setBackgroundColor(C.BG)
            isFillViewport = true
            addView(col)
        }
        scroll.setOnApplyWindowInsetsListener { v, insets ->
            if (Build.VERSION.SDK_INT >= 30) {
                val b = insets.getInsets(WindowInsets.Type.systemBars() or WindowInsets.Type.ime())
                v.setPadding(b.left, b.top, b.right, b.bottom)
            } else {
                @Suppress("DEPRECATION")
                v.setPadding(insets.systemWindowInsetLeft, insets.systemWindowInsetTop, insets.systemWindowInsetRight, insets.systemWindowInsetBottom)
            }
            insets
        }

        col.addView(text("จับเวลาสมาธิ", 20f, C.FG).apply { typeface = Typeface.DEFAULT_BOLD })

        // Dial
        roundText = text("", 16f, C.MUTED).apply { gravity = Gravity.CENTER }
        timeText = text("", 76f, C.FG).apply {
            gravity = Gravity.CENTER
            typeface = Typeface.create("sans-serif-light", Typeface.NORMAL)
            fontFeatureSettings = "tnum"
        }
        endText = text("", 14f, C.MUTED).apply { gravity = Gravity.CENTER }
        col.addView(roundText, full(top = 28))
        col.addView(timeText, full(top = 4))
        col.addView(endText, full(top = 2))

        startBtn = Button(this).apply {
            style(this, 20f, Color.WHITE)
            typeface = Typeface.DEFAULT_BOLD
            setOnClickListener { onMainButton() }
        }
        col.addView(startBtn, LinearLayout.LayoutParams(MATCH_PARENT, dp(64)).apply { topMargin = dp(28) })
        resetBtn = Button(this).apply {
            text = "↺ รีเซ็ต"
            style(this, 14f, C.MUTED)
            background = rounded(Color.TRANSPARENT, 999f, C.LINE)
            setOnClickListener { TimerEngine.reset(this@MainActivity); render() }
        }
        col.addView(resetBtn, LinearLayout.LayoutParams(WRAP_CONTENT, dp(38)).apply {
            gravity = Gravity.CENTER_HORIZONTAL; topMargin = dp(12)
        })

        warning = text("", 14f, 0xFFF0C27A.toInt()).apply {
            background = rounded(C.WARN_BG, 12f)
            setPadding(dp(14), dp(12), dp(14), dp(12))
            setOnClickListener { openExactAlarmSettings() }
        }
        col.addView(warning, full(top = 16))

        // Rounds
        val roundsPanel = panel(col, "รอบที่ตั้งไว้")
        totalText = text("", 13f, C.MUTED)
        (roundsPanel.getChildAt(0) as LinearLayout).addView(totalText)
        roundList = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        roundsPanel.addView(roundList, full(top = 12))

        editArea = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        roundsPanel.addView(editArea, full(top = 4))
        listOf(listOf(5, 10, 15, 20), listOf(30, 40, 45, 60)).forEach { rowValues ->
            val row = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
            rowValues.forEachIndexed { i, m ->
                row.addView(chip("+$m") { editRounds { it.add(m * 60) } }.apply {
                    contentDescription = "เพิ่มรอบ $m นาที"
                }, LinearLayout.LayoutParams(0, dp(44), 1f).apply { if (i > 0) leftMargin = dp(8) })
            }
            editArea.addView(row, full(top = 8))
        }
        editArea.addView(chip("ตั้งใหม่เป็น 4 × 40 นาที") { editRounds { it.clear(); repeat(4) { _ -> it.add(2400) } } },
            LinearLayout.LayoutParams(MATCH_PARENT, dp(44)).apply { topMargin = dp(8) })

        val addRow = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
        input = EditText(this).apply {
            hint = "เช่น 40, 40 หรือ 1:30"
            setHintTextColor(C.MUTED)
            setTextColor(C.FG)
            textSize = 16f
            inputType = InputType.TYPE_CLASS_TEXT
            imeOptions = EditorInfo.IME_ACTION_DONE
            background = rounded(C.BG, 12f, C.LINE)
            setPadding(dp(14), 0, dp(14), 0)
            setOnEditorActionListener { _, _, _ -> addTyped(); true }
        }
        addRow.addView(input, LinearLayout.LayoutParams(0, dp(48), 1f))
        addRow.addView(Button(this).apply {
            text = "เพิ่ม"
            style(this, 16f, C.FG)
            background = rounded(C.SURFACE, 12f, C.LINE)
            setOnClickListener { addTyped() }
        }, LinearLayout.LayoutParams(dp(76), dp(48)).apply { leftMargin = dp(8) })
        editArea.addView(addRow, full(top = 12))
        inputError = text("", 13f, C.DANGER).apply { visibility = View.GONE }
        editArea.addView(inputError, full(top = 6))
        editArea.addView(text("ใส่ได้หลายรอบพร้อมกัน คั่นด้วยจุลภาค เช่น 40, 40 • ใส่วินาทีได้แบบ นาที:วินาที", 13f, C.MUTED), full(top = 6))
        editArea.addView(Button(this).apply {
            text = "ลบทุกรอบ"
            style(this, 14f, C.MUTED)
            background = rounded(Color.TRANSPARENT, 999f, C.LINE)
            setOnClickListener { editRounds { it.clear() } }
        }, LinearLayout.LayoutParams(WRAP_CONTENT, dp(38)).apply { topMargin = dp(10) })

        // Sound
        val soundPanel = panel(col, "เสียงเตือนของแอพ")
        val group = RadioGroup(this)
        Sound.NAMES.forEach { (key, name) ->
            group.addView(RadioButton(this).apply {
                id = View.generateViewId()
                text = name
                textSize = 16f
                setTextColor(C.FG)
                buttonTintList = android.content.res.ColorStateList.valueOf(C.ACCENT)
                isChecked = store.sound == key
                setOnClickListener {
                    store.sound = key
                    Sound.play(this@MainActivity, key, store.volume, false)
                }
            }, RadioGroup.LayoutParams(MATCH_PARENT, dp(44)))
        }
        soundPanel.addView(group, full(top = 6))

        val volLabel = text("", 14f, C.MUTED)
        fun showVolume() { volLabel.text = "ความดังของแอพ ${store.volume}% (ไม่ขึ้นกับเสียงเรียกเข้า/สื่อของมือถือ)" }
        showVolume()
        soundPanel.addView(volLabel, full(top = 10))
        soundPanel.addView(SeekBar(this).apply {
            min = 10
            max = 100
            progress = store.volume
            progressTintList = android.content.res.ColorStateList.valueOf(C.ACCENT)
            thumbTintList = android.content.res.ColorStateList.valueOf(C.ACCENT)
            setOnSeekBarChangeListener(object : SeekBar.OnSeekBarChangeListener {
                override fun onProgressChanged(s: SeekBar, v: Int, fromUser: Boolean) { if (fromUser) { store.volume = v; showVolume() } }
                override fun onStartTrackingTouch(s: SeekBar) {}
                override fun onStopTrackingTouch(s: SeekBar) { Sound.play(this@MainActivity, store.sound, store.volume, false) }
            })
        }, full(top = 4))

        @Suppress("DEPRECATION")
        soundPanel.addView(Switch(this).apply {
            text = "สั่นด้วย"
            textSize = 16f
            setTextColor(C.FG)
            isChecked = store.vibrate
            setOnCheckedChangeListener { _, on -> store.vibrate = on }
        }, LinearLayout.LayoutParams(MATCH_PARENT, dp(48)).apply { topMargin = dp(6) })

        soundPanel.addView(Button(this).apply {
            text = "🔔 ทดสอบเสียง"
            style(this, 15f, C.FG)
            background = rounded(C.SURFACE, 12f, C.LINE)
            setOnClickListener { Sound.play(this@MainActivity, store.sound, store.volume, store.vibrate) }
        }, LinearLayout.LayoutParams(MATCH_PARENT, dp(46)).apply { topMargin = dp(6) })

        col.addView(text(
            "กดเริ่มแล้วล็อกหน้าจอได้เลย แอพใช้ระบบนาฬิกาปลุกของเครื่องปลุกเองทุกครั้งที่ครบรอบ " +
                "ไม่ต้องเปิดหน้าจอค้างไว้ จึงแทบไม่กินแบต\n" +
                "เสียงเตือนใช้ช่องเสียงนาฬิกาปลุก ดังได้แม้ปิดเสียงเรียกเข้าหรือเปิดโหมดสั่น",
            13f, C.MUTED,
        ).apply { gravity = Gravity.CENTER }, full(top = 20))

        return scroll
    }

    private fun openExactAlarmSettings() {
        if (Build.VERSION.SDK_INT >= 31 && !TimerEngine.canRingExactly(this)) {
            runCatching {
                startActivity(Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM, Uri.parse("package:$packageName")))
            }
        }
    }

    // ---------- small view helpers ----------

    private fun panel(parent: LinearLayout, title: String): LinearLayout {
        val p = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(16), dp(14), dp(16), dp(16))
            background = rounded(C.SURFACE, 18f, C.LINE)
        }
        val head = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
        head.addView(text(title, 13f, C.MUTED).apply { letterSpacing = 0.06f; typeface = Typeface.DEFAULT_BOLD },
            LinearLayout.LayoutParams(0, WRAP_CONTENT, 1f))
        p.addView(head)
        parent.addView(p, full(top = 20))
        return p
    }

    private fun chip(label: String, onClick: () -> Unit) = Button(this).apply {
        text = label
        style(this, 15f, C.FG)
        background = rounded(C.BG, 999f, C.LINE)
        setOnClickListener { onClick() }
    }

    private fun style(b: Button, sp: Float, color: Int) {
        b.isAllCaps = false
        b.textSize = sp
        b.setTextColor(color)
        b.stateListAnimator = null
        b.setPadding(dp(12), 0, dp(12), 0)
    }

    private fun text(s: String, sp: Float, color: Int) = TextView(this).apply {
        text = s
        setTextSize(TypedValue.COMPLEX_UNIT_SP, sp)
        setTextColor(color)
    }

    private fun rounded(fill: Int, radiusDp: Float, stroke: Int? = null) = GradientDrawable().apply {
        setColor(fill)
        cornerRadius = radiusDp * resources.displayMetrics.density
        if (stroke != null) setStroke(dp(1), stroke)
    }

    private fun full(top: Int = 0) = LinearLayout.LayoutParams(MATCH_PARENT, WRAP_CONTENT).apply { topMargin = dp(top) }

    private fun setEnabledDeep(v: View, on: Boolean) {
        v.isEnabled = on
        if (v is android.view.ViewGroup) for (i in 0 until v.childCount) setEnabledDeep(v.getChildAt(i), on)
    }

    private fun dp(v: Int) = (v * resources.displayMetrics.density).toInt()
}
