package `in`.clor.attendance.ui

import android.graphics.Paint
import android.graphics.Typeface
import android.graphics.pdf.PdfDocument
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.automirrored.outlined.KeyboardArrowRight
import androidx.compose.material3.Button
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import `in`.clor.attendance.data.Api
import `in`.clor.attendance.data.PayLine
import `in`.clor.attendance.data.Payslip
import java.io.ByteArrayOutputStream
import java.text.NumberFormat
import java.util.Locale

/*
 * Payslips (portal /payslips): the person's own, from payrolls HR has locked.
 * A list in Me, one payslip on its own screen, and a PDF the phone makes
 * itself to save or share (a bank asks for one with a loan).
 */

private val inr: NumberFormat = NumberFormat.getCurrencyInstance(Locale("en", "IN")).apply { maximumFractionDigits = 2 }
fun rupees(v: Double): String = inr.format(v)

/** The list, in Me. Nothing at all when the company does not run payroll in CLOR. */
@Composable
fun PayslipsSection(api: Api, onSignedOut: () -> Unit, onOpen: (String) -> Unit) {
    /* A server without payslips yet (404) hides the section instead of showing an error. */
    val list = rememberLoad(onSignedOut) {
        try { api.payslips() } catch (e: `in`.clor.attendance.data.ApiError) { if (e.status == 404) `in`.clor.attendance.data.Payslips() else throw e }
    }
    val state = list.state
    if (state is Load.Ready && !state.value.available) return
    Section("My payslips") {
        LoadView(list) { p ->
            if (p.slips.isEmpty()) Hint("No payslips yet. They appear here once HR locks the month's payroll.")
            p.slips.forEachIndexed { i, s ->
                if (i > 0) HorizontalDivider()
                Row(
                    Modifier.fillMaxWidth().clickable { onOpen(s.id) }.padding(vertical = 8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    Column(Modifier.weight(1f)) {
                        Text(s.period, style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.SemiBold)
                        Hint("Net pay ${rupees(s.net)}")
                    }
                    StatusPill(if (s.paid) "Paid" else "Not paid yet", if (s.paid) Tone.Pos else Tone.Warn)
                    Icon(Icons.AutoMirrored.Outlined.KeyboardArrowRight, contentDescription = "Open ${s.period}")
                }
            }
        }
    }
}

/** One payslip, with Save PDF. */
@Composable
fun PayslipScreen(api: Api, id: String, onBack: () -> Unit, onSignedOut: () -> Unit, onSave: (Payslip) -> Unit) {
    androidx.activity.compose.BackHandler(onBack = onBack)
    val one = rememberLoad(onSignedOut, id) { api.payslip(id).slip }
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(screenPadding), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Outlined.ArrowBack, contentDescription = "Back") }
            Text("Payslip", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.SemiBold)
        }
        LoadView(one) { s ->
            Section {
                Text(s.period, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                Hint(listOf(s.company, s.number).filter { it.isNotBlank() }.joinToString(" · "))
                Row(Modifier.fillMaxWidth().padding(top = 6.dp), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.Bottom) {
                    Column {
                        Hint("Net pay")
                        Text(rupees(s.net), style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
                    }
                    StatusPill(if (s.paid) "Paid" else "Not paid yet", if (s.paid) Tone.Pos else Tone.Warn)
                }
            }
            Section("Days") {
                Amount("Working days", fmtNum(s.days.working))
                Amount("Paid days", fmtNum(s.days.payable))
                if (s.days.lossOfPay > 0) Amount("Loss of pay", fmtNum(s.days.lossOfPay))
            }
            Lines("Earnings", s.earnings, "Gross earnings", s.gross)
            Lines("Deductions", s.deductions, "Total deductions", s.totalDeductions)
            Section("Details") {
                Amount("Name", listOf(s.employee.name, s.employee.code).filter { it.isNotBlank() }.joinToString(" · "))
                if (s.employee.designation.isNotBlank()) Amount("Designation", s.employee.designation)
                if (s.employee.pan.isNotBlank()) Amount("PAN", s.employee.pan)
                if (s.employee.uan.isNotBlank()) Amount("UAN", s.employee.uan)
                if (s.employee.account.isNotBlank()) Amount("Bank", listOf(s.employee.bank, s.employee.account).filter { it.isNotBlank() }.joinToString(" "))
            }
            Button(onClick = { onSave(s) }, modifier = Modifier.fillMaxWidth()) { Text("Save PDF") }
            Hint("PAN and bank account are shown with only their last digits.")
        }
    }
}

@Composable
private fun Lines(title: String, lines: List<PayLine>, totalLabel: String, total: Double) {
    Section(title) {
        if (lines.isEmpty()) Hint("None this month.")
        lines.forEach { Amount(it.name, rupees(it.amount)) }
        HorizontalDivider()
        Amount(totalLabel, rupees(total), bold = true)
    }
}

@Composable
private fun Amount(label: String, value: String, bold: Boolean = false) {
    Row(Modifier.fillMaxWidth().padding(vertical = 3.dp), horizontalArrangement = Arrangement.SpaceBetween) {
        Text(label, style = MaterialTheme.typography.bodyMedium, fontWeight = if (bold) FontWeight.SemiBold else FontWeight.Normal, modifier = Modifier.weight(1f))
        Text(value, style = MaterialTheme.typography.bodyMedium, fontWeight = if (bold) FontWeight.SemiBold else FontWeight.Normal)
    }
}

private fun fmtNum(d: Double) = if (d % 1.0 == 0.0) d.toInt().toString() else "%.1f".format(d)

/** The payslip as an A4 PDF, drawn on the phone (no server round trip). */
object PayslipPdf {
    fun build(s: Payslip): ByteArray {
        val doc = PdfDocument()
        val page = doc.startPage(PdfDocument.PageInfo.Builder(595, 842, 1).create())
        val c = page.canvas
        val text = Paint().apply { textSize = 10f; isAntiAlias = true; color = 0xFF070D0D.toInt() }
        val muted = Paint(text).apply { color = 0xFF4B5258.toInt() }
        val bold = Paint(text).apply { typeface = Typeface.create(Typeface.DEFAULT, Typeface.BOLD) }
        val title = Paint(bold).apply { textSize = 16f }
        val rule = Paint().apply { color = 0xFFDDE0E4.toInt(); strokeWidth = 1f }
        val left = 40f
        val right = 555f
        var y = 56f
        fun line(label: String, value: String, p: Paint = text) {
            c.drawText(label, left, y, p)
            c.drawText(value, right - p.measureText(value), y, p)
            y += 16f
        }
        fun gap(h: Float = 8f) { y += h }
        fun hr() { c.drawLine(left, y - 10f, right, y - 10f, rule); gap(4f) }

        c.drawText(s.company.ifBlank { "Payslip" }, left, y, title); y += 20f
        c.drawText("Payslip for ${s.period}${if (s.number.isNotBlank()) " · ${s.number}" else ""}", left, y, muted); y += 26f
        line("Name", listOf(s.employee.name, s.employee.code).filter { it.isNotBlank() }.joinToString(" · "))
        if (s.employee.designation.isNotBlank()) line("Designation", s.employee.designation)
        if (s.employee.department.isNotBlank()) line("Department", s.employee.department)
        if (s.employee.pan.isNotBlank()) line("PAN", s.employee.pan)
        if (s.employee.uan.isNotBlank()) line("UAN", s.employee.uan)
        if (s.employee.account.isNotBlank()) line("Bank account", listOf(s.employee.bank, s.employee.account).filter { it.isNotBlank() }.joinToString(" "))
        line("Working days / paid days", "${fmtNum(s.days.working)} / ${fmtNum(s.days.payable)}")
        if (s.days.lossOfPay > 0) line("Loss of pay days", fmtNum(s.days.lossOfPay))
        gap(10f); hr()
        c.drawText("Earnings", left, y, bold); y += 18f
        s.earnings.forEach { line(it.name, rupees(it.amount)) }
        line("Gross earnings", rupees(s.gross), bold)
        gap(10f); hr()
        c.drawText("Deductions", left, y, bold); y += 18f
        if (s.deductions.isEmpty()) line("None", rupees(0.0))
        s.deductions.forEach { line(it.name, rupees(it.amount)) }
        line("Total deductions", rupees(s.totalDeductions), bold)
        gap(10f); hr()
        line("Net pay", rupees(s.net), title)
        gap(24f)
        c.drawText("Generated from CLOR on the employee's phone. PAN and bank account show only their last digits.", left, y, muted)
        doc.finishPage(page)
        val out = ByteArrayOutputStream()
        doc.writeTo(out)
        doc.close()
        return out.toByteArray()
    }
}
