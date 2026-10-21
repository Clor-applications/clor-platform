package `in`.clor.attendance.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.KeyboardArrowRight
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.CalendarMonth
import androidx.compose.material.icons.outlined.Celebration
import androidx.compose.material.icons.outlined.CheckCircle
import androidx.compose.material.icons.outlined.Description
import androidx.compose.material.icons.outlined.EditCalendar
import androidx.compose.material.icons.outlined.EventAvailable
import androidx.compose.material.icons.outlined.EventBusy
import androidx.compose.material.icons.outlined.Groups
import androidx.compose.material.icons.outlined.Inbox
import androidx.compose.material.icons.outlined.LocationOn
import androidx.compose.material.icons.outlined.Schedule
import androidx.compose.material.icons.outlined.WarningAmber
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.ListItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import `in`.clor.attendance.data.Api
import `in`.clor.attendance.data.Home
import java.time.LocalDate
import java.time.YearMonth
import java.time.format.DateTimeFormatter
import java.util.Locale

/** Where the home screen can send someone. */
class HomeLinks(
    val request: (NewKind) -> Unit,
    val requests: () -> Unit,
    val attendance: () -> Unit,
    val applyLeave: () -> Unit,
    val leave: () -> Unit,
    val approvals: () -> Unit,
    val me: () -> Unit,
    val attention: () -> Unit = attendance,
    /** My payslips, in Me. */
    val payslips: () -> Unit = me,
)

/**
 * Home, as the leading HR apps lay it out (greytHR, Keka, Zoho People): who
 * and where at the top, what needs attention, the punch card, this month at a
 * glance, the week, leave, the next holidays, the team, and quick actions.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun HomeTab(api: Api, version: Int, links: HomeLinks, onChanged: () -> Unit, onSignedOut: () -> Unit) {
    val home = rememberLoad(onSignedOut, version) { api.home() }
    Box(Modifier.fillMaxSize()) {
        Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState())) {
            LoadView(home) { h ->
                Header(h)
                Column(Modifier.padding(horizontal = 16.dp).padding(bottom = 24.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
                    Alerts(h, links)
                    PunchCard(api, h.shift, h.record, h.punches, h.phone, onPunched = { home.reload(); onChanged() }, onSignedOut = onSignedOut,
                        onAskPhone = { links.request(NewKind.Phone) }, onFix = { links.request(NewKind.Missed) }, onDuty = { links.request(NewKind.OnDuty) })
                    /* Right under the punch, where a thumb reaches; this replaces the + button that duplicated them and covered the cards (MX-07, MX-09). */
                    QuickActions(h, links)
                    SectionTitle("This month", YearMonth.parse(h.month.month.ifEmpty { YearMonth.now().toString() }).format(DateTimeFormatter.ofPattern("MMMM yyyy", Locale.ENGLISH)))
                    MonthGrid(h, links)
                    WeekChart(h)
                    RateBar(h)
                    if (h.leave.balances.isNotEmpty()) LeaveStrip(h, links)
                    if (h.holidays.isNotEmpty()) Holidays(h)
                    if (h.approvals.approver) Team(h, links)
                    RemindersCard()
                }
            }
        }
    }
}


/** Brand, product and client, with the site on the right — and a strip with the person and the period. */
@Composable
private fun Header(h: Home) {
    Surface(color = MaterialTheme.colorScheme.surface) {
        Column(Modifier.fillMaxWidth().padding(start = 16.dp, end = 16.dp, top = 14.dp, bottom = 14.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                /* The CLOR Attendance icon, as on the web app catalogue. */
                androidx.compose.foundation.Image(androidx.compose.ui.res.painterResource(`in`.clor.attendance.R.drawable.clor_app_icon), contentDescription = "CLOR Attendance", modifier = Modifier.size(46.dp))
                Column(Modifier.weight(1f).padding(start = 12.dp)) {
                    /* One line that gives way to the site chip; the "Employee" chip used to wrap a syllable per line (MX-08). */
                    Text("CLOR Attendance", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.ExtraBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    Text(h.company.name, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
                (h.site ?: "Site not set").let { site ->
                    Row(
                        Modifier.widthIn(max = 150.dp).border(1.dp, MaterialTheme.colorScheme.outline, RoundedCornerShape(50)).background(MaterialTheme.colorScheme.surfaceVariant, RoundedCornerShape(50)).padding(horizontal = 10.dp, vertical = 6.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Icon(Icons.Outlined.LocationOn, contentDescription = "Site", tint = Brand, modifier = Modifier.size(16.dp))
                        Text(site, style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(start = 4.dp))
                    }
                }
            }
            Row(
                Modifier.fillMaxWidth().background(MaterialTheme.colorScheme.surfaceVariant, RoundedCornerShape(10.dp)).padding(horizontal = 12.dp, vertical = 10.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(Icons.Outlined.CheckCircle, contentDescription = null, tint = Pos, modifier = Modifier.size(16.dp))
                Text(
                    listOfNotNull(h.employee.name, h.employee.code, h.employee.designation ?: h.employee.department).joinToString(" · "),
                    style = MaterialTheme.typography.labelMedium, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f).padding(start = 6.dp),
                )
                Text(shortDate(h.today), style = MaterialTheme.typography.labelMedium, color = Brand, fontWeight = FontWeight.SemiBold)
            }
        }
    }
}

/** The one or two things that need doing, most urgent first, each a tap away. */
@Composable
private fun Alerts(h: Home, links: HomeLinks) {
    if (h.attentionCount > 0) {
        AlertBanner(
            tone = Tone.Neg,
            title = "${h.attentionCount} day${if (h.attentionCount == 1) "" else "s"} need${if (h.attentionCount == 1) "s" else ""} attention",
            text = h.attention.take(2).joinToString(" · ") { "${shortDate(it.date)}: ${it.why}" } + if (h.attentionCount > 2) " · …" else "",
            onClick = links.attention,
        )
    }
    if (h.approvals.waiting > 0) {
        AlertBanner(Tone.Warn, "${h.approvals.waiting} request${if (h.approvals.waiting == 1) "" else "s"} waiting for you", "Leave and corrections from your team", links.approvals)
    }
    val mine = h.leave.pending + h.corrections.pending
    if (mine > 0 && h.attentionCount == 0) {
        AlertBanner(Tone.Neutral, "$mine of your request${if (mine == 1) " is" else "s are"} with HR", "You get a notification when it is decided", links.requests)
    }
}

@Composable
private fun AlertBanner(tone: Tone, title: String, text: String, onClick: () -> Unit) {
    val c = when (tone) { Tone.Neg -> Neg; Tone.Warn -> Warn; Tone.Pos -> Pos; Tone.Neutral -> MaterialTheme.colorScheme.onSurfaceVariant }
    Row(
        Modifier.fillMaxWidth().background(c.copy(alpha = 0.08f), RoundedCornerShape(14.dp)).border(1.dp, c.copy(alpha = 0.35f), RoundedCornerShape(14.dp)).clickable(onClick = onClick).padding(14.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(Modifier.size(38.dp).background(c, RoundedCornerShape(50)), contentAlignment = Alignment.Center) {
            Icon(if (tone == Tone.Neutral) Icons.Outlined.Schedule else Icons.Outlined.WarningAmber, contentDescription = null, tint = Color.White, modifier = Modifier.size(20.dp))
        }
        Column(Modifier.weight(1f).padding(horizontal = 12.dp)) {
            Text(title, color = c, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.Bold)
            Text(text, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 2, overflow = TextOverflow.Ellipsis)
        }
        Icon(Icons.AutoMirrored.Outlined.KeyboardArrowRight, contentDescription = null, tint = c)
    }
}

@Composable
private fun SectionTitle(title: String, right: String?) {
    Row(Modifier.fillMaxWidth().padding(top = 4.dp), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.Bottom) {
        Text(title, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
        right?.let { Text(it, style = MaterialTheme.typography.labelMedium, color = Brand, fontWeight = FontWeight.SemiBold) }
    }
}

@Composable
private fun MonthGrid(h: Home, links: HomeLinks) {
    val m = h.month
    val leaveLeft = h.leave.balances.mapNotNull { it.available }.sum()
    /* Wide screens: the four cards in one row; phones: two by two. */
    val wide = androidx.compose.ui.platform.LocalConfiguration.current.screenWidthDp >= 600
    if (wide) {
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            StatCard(Modifier.weight(1f), "Present", fmtDays(m.present), "of ${m.workingDays} working days", Icons.Outlined.CheckCircle, Pos, m.rate?.let { "$it%" to Tone.Pos }, links.attendance)
            StatCard(Modifier.weight(1f), "Late", "${m.late}", if (m.lateMinutes > 0) "${m.lateMinutes} min in all" else "days this month", Icons.Outlined.Schedule, Warn, if (m.late > 0) "Late" to Tone.Warn else "On time" to Tone.Pos, links.attendance)
            StatCard(Modifier.weight(1f), "Absent", "${m.absent}", "days this month", Icons.Outlined.EventBusy, Neg, if (m.absent > 0) "Check" to Tone.Neg else null, links.attendance)
            StatCard(Modifier.weight(1f), "Leave left", if (h.leave.balances.any { it.available != null }) fmtDays(leaveLeft) else "—", "${m.leave} day${if (m.leave == 1) "" else "s"} taken this month", Icons.Outlined.EventAvailable, LeaveTone, if (h.leave.pending > 0) "${h.leave.pending} waiting" to Tone.Warn else null, links.leave)
        }
        return
    }
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            StatCard(Modifier.weight(1f), "Present", fmtDays(m.present), "of ${m.workingDays} working days", Icons.Outlined.CheckCircle, Pos, m.rate?.let { "$it%" to Tone.Pos }, links.attendance)
            StatCard(Modifier.weight(1f), "Late", "${m.late}", if (m.lateMinutes > 0) "${m.lateMinutes} min in all" else "days this month", Icons.Outlined.Schedule, Warn, if (m.late > 0) "Late" to Tone.Warn else "On time" to Tone.Pos, links.attendance)
        }
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            StatCard(Modifier.weight(1f), "Absent", "${m.absent}", "days this month", Icons.Outlined.EventBusy, Neg, if (m.absent > 0) "Check" to Tone.Neg else null, links.attendance)
            StatCard(Modifier.weight(1f), "Leave left", if (h.leave.balances.any { it.available != null }) fmtDays(leaveLeft) else "—", "${m.leave} day${if (m.leave == 1) "" else "s"} taken this month", Icons.Outlined.EventAvailable, LeaveTone, if (h.leave.pending > 0) "${h.leave.pending} waiting" to Tone.Warn else null, links.leave)
        }
    }
}

private fun fmtDays(d: Double) = if (d % 1.0 == 0.0) d.toInt().toString() else "%.1f".format(d)

@Composable
private fun StatCard(modifier: Modifier, label: String, value: String, sub: String, icon: ImageVector, tint: Color, chip: Pair<String, Tone>?, onClick: () -> Unit) {
    Column(
        modifier.background(MaterialTheme.colorScheme.surface, RoundedCornerShape(16.dp)).border(1.dp, MaterialTheme.colorScheme.outline, RoundedCornerShape(16.dp)).clickable(onClick = onClick).padding(14.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.Top) {
            Text(label, style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
            IconTile(icon, tint)
        }
        Text(value, style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
            Text(sub, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 2, modifier = Modifier.weight(1f))
            chip?.let { (t, tone) -> StatusPill(t, tone) }
        }
    }
}

/** Hours worked over the last seven days; today in the brand colour, days off shown as off. */
@Composable
private fun WeekChart(h: Home) {
    val week = h.week
    if (week.isEmpty()) return
    val max = (week.maxOf { it.workedMinutes }.coerceAtLeast(9 * 60)).toFloat()
    val worked = week.filter { it.workedMinutes > 0 }
    val avg = if (worked.isEmpty()) 0 else worked.sumOf { it.workedMinutes } / worked.size
    val grey = MaterialTheme.colorScheme.outline
    val muted = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.35f)
    Section {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
            Column {
                Text("Last 7 days", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
                Hint("Hours worked each day")
            }
            Box(Modifier.background(Brand.copy(alpha = 0.10f), RoundedCornerShape(8.dp)).padding(horizontal = 10.dp, vertical = 6.dp)) {
                Text("Avg ${hm(avg)}", color = Brand, style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.Bold)
            }
        }
        Row(Modifier.fillMaxWidth().height(150.dp).padding(top = 8.dp), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.Bottom) {
            week.forEach { d ->
                val isToday = d.date == h.today
                Column(Modifier.weight(1f), horizontalAlignment = Alignment.CenterHorizontally) {
                    Text(if (d.workedMinutes > 0) "%.1f".format(d.workedMinutes / 60f) else if (d.status == "OFF") "off" else "", style = MaterialTheme.typography.labelSmall, color = if (isToday) Brand else MaterialTheme.colorScheme.onSurfaceVariant)
                    Spacer(Modifier.height(4.dp))
                    val accent = Brand
                    Canvas(Modifier.width(26.dp).height(100.dp)) {
                        val frac = (d.workedMinutes / max).coerceIn(0f, 1f)
                        val barH = if (d.workedMinutes > 0) size.height * frac else 6f
                        drawRoundRect(
                            color = if (isToday) accent else if (d.workedMinutes > 0) grey.copy(alpha = 1f) else muted,
                            topLeft = Offset(0f, size.height - barH),
                            size = Size(size.width, barH),
                            cornerRadius = CornerRadius(10f, 10f),
                        )
                    }
                    Spacer(Modifier.height(6.dp))
                    Text(runCatching { LocalDate.parse(d.date).dayOfWeek.name.take(3).lowercase().replaceFirstChar { it.uppercase() } }.getOrDefault(""), style = MaterialTheme.typography.labelSmall, fontWeight = if (isToday) FontWeight.Bold else FontWeight.Normal)
                }
            }
        }
    }
}

/** Attendance rate this month: present against the working days so far. */
@Composable
private fun RateBar(h: Home) {
    val m = h.month
    if (m.workingDays == 0) return
    val p = (m.present / m.workingDays).toFloat().coerceIn(0f, 1f)
    val l = (m.leave.toFloat() / m.workingDays).coerceIn(0f, 1f - p)
    val a = (m.absent.toFloat() / m.workingDays).coerceIn(0f, 1f - p - l)
    Section {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Icon(Icons.Outlined.CalendarMonth, contentDescription = null, tint = Pos)
                Text("Attendance rate", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
            }
            StatusPill("${m.rate ?: 0}% present", if ((m.rate ?: 0) >= 90) Tone.Pos else Tone.Warn)
        }
        Row(Modifier.fillMaxWidth().height(10.dp).background(MaterialTheme.colorScheme.surfaceVariant, RoundedCornerShape(50))) {
            if (p > 0) Box(Modifier.weight(p).fillMaxSize().background(Pos, RoundedCornerShape(50)))
            if (l > 0) Box(Modifier.weight(l).fillMaxSize().background(LeaveTone))
            if (a > 0) Box(Modifier.weight(a).fillMaxSize().background(Neg))
            val rest = 1f - p - l - a
            if (rest > 0.001f) Spacer(Modifier.weight(rest))
        }
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            Legend(Pos, "Present ${fmtDays(m.present)}")
            Legend(LeaveTone, "Leave ${m.leave}")
            Legend(Neg, "Absent ${m.absent}")
        }
    }
}

@Composable
private fun Legend(c: Color, text: String) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.size(8.dp).background(c, RoundedCornerShape(50)))
        Text(text, style = MaterialTheme.typography.labelMedium, modifier = Modifier.padding(start = 6.dp))
    }
}

@Composable
private fun LeaveStrip(h: Home, links: HomeLinks) {
    SectionTitle("Leave balance", null)
    Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        h.leave.balances.forEach { b ->
            Column(
                Modifier.width(140.dp).background(MaterialTheme.colorScheme.surface, RoundedCornerShape(14.dp)).border(1.dp, MaterialTheme.colorScheme.outline, RoundedCornerShape(14.dp)).clickable(onClick = links.leave).padding(12.dp),
                verticalArrangement = Arrangement.spacedBy(4.dp),
            ) {
                Text(b.name, style = MaterialTheme.typography.labelLarge, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text(b.available?.let { fmtDays(it) } ?: "∞", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold, color = Brand)
                Hint("left · ${fmtDays(b.used)} used")
            }
        }
        Column(
            Modifier.width(120.dp).background(Brand.copy(alpha = 0.08f), RoundedCornerShape(14.dp)).clickable(onClick = links.applyLeave).padding(12.dp),
            verticalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            Icon(Icons.Outlined.Add, contentDescription = null, tint = Brand)
            Text("Apply for leave", style = MaterialTheme.typography.labelLarge, color = Brand, fontWeight = FontWeight.SemiBold)
        }
    }
}

@Composable
private fun Holidays(h: Home) {
    Section {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Icon(Icons.Outlined.Celebration, contentDescription = null, tint = Brand)
            Text("Upcoming holidays", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
        }
        h.holidays.forEach { d ->
            val date = runCatching { LocalDate.parse(d.date) }.getOrNull()
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp), modifier = Modifier.padding(vertical = 2.dp)) {
                Column(Modifier.width(46.dp).background(Brand.copy(alpha = 0.10f), RoundedCornerShape(10.dp)).padding(vertical = 4.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                    Text(date?.dayOfMonth?.toString() ?: "", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold, color = Brand)
                    Text(date?.month?.name?.take(3)?.lowercase()?.replaceFirstChar { it.uppercase() } ?: "", style = MaterialTheme.typography.labelSmall, color = Brand)
                }
                Column {
                    Text(d.name, style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.Medium)
                    Hint(date?.dayOfWeek?.name?.lowercase()?.replaceFirstChar { it.uppercase() } ?: "")
                }
            }
        }
    }
}

@Composable
private fun Team(h: Home, links: HomeLinks) {
    Section {
        Row(Modifier.fillMaxWidth().clickable(onClick = links.approvals), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            IconTile(Icons.Outlined.Groups, Brand)
            Column(Modifier.weight(1f)) {
                Text("My team · ${h.approvals.team}", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
                Hint(if (h.approvals.awayToday.isEmpty()) "Nobody on leave today" else "On leave today: ${h.approvals.awayToday.joinToString()}")
            }
            if (h.approvals.waiting > 0) StatusPill("${h.approvals.waiting} to review", Tone.Warn)
        }
    }
}

@Composable
private fun QuickActions(h: Home, links: HomeLinks) {
    val items = buildList {
        add(Triple(Icons.Outlined.EventAvailable to LeaveTone, "Apply leave", links.applyLeave))
        add(Triple(Icons.Outlined.EditCalendar to Pos, "Fix a punch", { links.request(NewKind.Missed) }))
        if (h.payroll) add(Triple(Icons.Outlined.Description to Brand, "Payslips", links.payslips))
        else add(Triple(NewKind.OnDuty.icon to Warn, "On duty", { links.request(NewKind.OnDuty) }))
        if (h.approvals.approver) add(Triple(Icons.Outlined.Inbox to Brand, "Approvals", links.approvals))
        else add(Triple(Icons.Outlined.Inbox to Brand, "Requests", links.requests))
    }
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        items.forEach { (iconTint, label, go) ->
            Column(
                Modifier.weight(1f).background(MaterialTheme.colorScheme.surface, RoundedCornerShape(14.dp)).border(1.dp, MaterialTheme.colorScheme.outline, RoundedCornerShape(14.dp)).clickable(onClick = go).padding(vertical = 14.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                IconTile(iconTint.first, iconTint.second)
                Text(label, style = MaterialTheme.typography.labelMedium, maxLines = 1)
            }
        }
    }
}
