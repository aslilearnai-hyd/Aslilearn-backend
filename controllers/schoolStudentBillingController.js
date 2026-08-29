import PDFDocument from 'pdfkit';
import XLSX from 'xlsx';
import User from '../models/User.js';
import Teacher from '../models/Teacher.js';

function statusFor(student) {
  const now = Date.now();
  if (!student.schoolStudentSubscriptionEnabled) return 'not-required';
  if (student.subscriptionStatus === 'active' && student.subscriptionExpiresAt && new Date(student.subscriptionExpiresAt).getTime() > now) return 'paid';
  if (student.trialEndsAt && new Date(student.trialEndsAt).getTime() > now) return 'trial';
  return 'expired';
}

function rowFor(student) {
  const last = Array.isArray(student.subscriptionPayments) ? student.subscriptionPayments[0] : null;
  return {
    id: String(student._id),
    name: student.fullName || student.name || '',
    email: student.email || '',
    class: student.classNumber || '',
    section: student.section || '',
    status: statusFor(student),
    paymentMode: last?.source === 'manual' ? 'offline' : last?.source === 'razorpay' ? 'online' : '',
    amountInr: Number(last?.amountInr || student.trialPaymentAmount || 0),
    paidAt: last?.paidAt || student.trialPaidAt || null,
    validUntil: student.subscriptionExpiresAt || null,
  };
}

async function loadRows(adminId, query = {}) {
  const filter = { role: 'student', assignedAdmin: adminId, isIndividualAccount: { $ne: true } };
  if (query.classNumber) filter.classNumber = String(query.classNumber);
  const students = await User.find(filter)
    .select('fullName name email classNumber section schoolStudentSubscriptionEnabled subscriptionStatus subscriptionExpiresAt trialEndsAt trialPaidAt trialPaymentAmount subscriptionPayments')
    .sort({ classNumber: 1, fullName: 1 })
    .lean();
  let rows = students.map(rowFor);
  if (query.status) rows = rows.filter((row) => row.status === query.status);
  return rows;
}

export async function listSchoolStudentSubscriptions(req, res) {
  try {
    const rows = await loadRows(req.params.adminId, req.query);
    const summary = rows.reduce((acc, row) => {
      acc.total += 1;
      acc[row.status] = (acc[row.status] || 0) + 1;
      if (row.status === 'paid') acc.collectedInr += row.amountInr;
      return acc;
    }, { total: 0, paid: 0, trial: 0, expired: 0, 'not-required': 0, collectedInr: 0 });
    return res.json({ success: true, summary, students: rows });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message || 'Could not load student subscriptions.' });
  }
}

export async function activateSchoolStudentSubscription(req, res) {
  try {
    const student = await User.findOne({ _id: req.params.studentId, assignedAdmin: req.params.adminId, role: 'student', isIndividualAccount: { $ne: true } });
    if (!student) return res.status(404).json({ success: false, message: 'Student not found for this school.' });
    const paidAt = new Date();
    const expiresAt = new Date(paidAt);
    expiresAt.setFullYear(expiresAt.getFullYear() + 1);
    const amountInr = Math.max(0, Number(req.body?.amountInr ?? student.schoolStudentAnnualPriceInr) || 0);
    const reference = String(req.body?.reference || `MANUAL-${Date.now()}`).slice(0, 120);
    student.schoolStudentSubscriptionEnabled = true;
    student.subscriptionStatus = 'active';
    student.subscriptionPeriod = 'year';
    student.subscriptionExpiresAt = expiresAt;
    student.trialPaidAt = paidAt;
    student.trialPaymentAmount = amountInr;
    student.trialPaymentMethod = 'offline';
    student.trialPaymentReference = reference;
    student.subscriptionPayments = [{
      paidAt, amountInr, packageType: 'school', packageLabel: 'School student yearly plan', period: 'year',
      periodLabel: 'Yearly', paymentMethod: 'offline', paymentReference: reference, validUntil: expiresAt,
      status: 'paid', source: 'manual', recordedBy: req.user?.email || String(req.userId || ''),
    }, ...(student.subscriptionPayments || [])].slice(0, 20);
    await student.save();
    return res.json({ success: true, message: 'Student yearly access activated.', student: rowFor(student.toObject()) });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message || 'Could not activate student access.' });
  }
}

export async function exportSchoolStudentSubscriptions(req, res) {
  try {
    const rows = await loadRows(req.params.adminId, req.query);
    const exportRows = rows.map(({ id, ...row }) => row);
    if (String(req.query.format).toLowerCase() === 'pdf') {
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="student-subscriptions-${req.params.adminId}.pdf"`);
      const doc = new PDFDocument({ margin: 36, size: 'A4' });
      doc.pipe(res);
      doc.fontSize(18).text('Student Subscription Report').moveDown();
      exportRows.forEach((row, index) => doc.fontSize(9).text(`${index + 1}. ${row.name} | ${row.class}${row.section ? `-${row.section}` : ''} | ${row.status} | ${row.paymentMode || '-'} | INR ${row.amountInr} | ${row.validUntil ? new Date(row.validUntil).toLocaleDateString('en-IN') : '-'}`));
      doc.end();
      return;
    }
    const sheet = XLSX.utils.json_to_sheet(exportRows);
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, sheet, 'Student subscriptions');
    const buffer = XLSX.write(book, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="student-subscriptions-${req.params.adminId}.xlsx"`);
    return res.send(buffer);
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message || 'Could not export student subscriptions.' });
  }
}

function paymentRowsFor(account, accountType) {
  const payments = Array.isArray(account.subscriptionPayments) ? account.subscriptionPayments : [];
  const base = {
    accountId: String(account._id),
    accountType,
    role: account.role || accountType,
    name: account.fullName || account.name || '',
    email: account.email || '',
    schoolName: account.assignedAdmin?.schoolName || account.schoolName || (account.isIndividualAccount ? 'Individual account' : ''),
    classNumber: account.classNumber || '',
    isSchoolManaged: Boolean(account.schoolStudentSubscriptionEnabled),
  };
  if (payments.length) return payments.map((payment, index) => ({
    id: `${base.accountId}-${payment.paymentReference || payment.razorpayOrderId || index}`,
    ...base,
    paidAt: payment.paidAt || null,
    amountInr: Number(payment.amountInr || 0),
    method: payment.paymentMethod || payment.source || '',
    source: payment.source || '',
    reference: payment.paymentReference || payment.razorpayOrderId || '',
    packageLabel: payment.packageLabel || payment.packageType || '',
    period: payment.periodLabel || payment.period || '',
    validUntil: payment.validUntil || null,
    status: payment.status || 'paid',
  }));
  if (!account.trialPaidAt && !account.trialPaymentReference) return [];
  return [{ id: `${base.accountId}-legacy`, ...base, paidAt: account.trialPaidAt || null,
    amountInr: Number(account.trialPaymentAmount || 0), method: account.trialPaymentMethod || '', source: 'legacy',
    reference: account.trialPaymentReference || '', packageLabel: account.paidPackage || '', period: account.subscriptionPeriod || '',
    validUntil: account.subscriptionExpiresAt || null, status: 'paid' }];
}

/** One Super Admin ledger containing every recorded B2C and B2B student payment. */
export async function listAllSubscriptionPayments(req, res) {
  try {
    const [users, teachers] = await Promise.all([
      User.find({
        role: 'student',
        $or: [
          { isIndividualAccount: true },
          { schoolStudentSubscriptionEnabled: true },
          { 'subscriptionPayments.0': { $exists: true } },
        ],
      }).select('fullName email role schoolName classNumber assignedAdmin isIndividualAccount schoolStudentSubscriptionEnabled subscriptionPayments trialPaidAt trialPaymentAmount trialPaymentMethod trialPaymentReference paidPackage subscriptionPeriod subscriptionExpiresAt')
        .populate('assignedAdmin', 'schoolName').lean(),
      Teacher.find({ $or: [{ isIndividualAccount: true }, { 'subscriptionPayments.0': { $exists: true } }] })
        .select('fullName name email role schoolName isIndividualAccount subscriptionPayments trialPaidAt trialPaymentAmount trialPaymentMethod trialPaymentReference paidPackage subscriptionPeriod subscriptionExpiresAt').lean(),
    ]);
    const payments = [
      ...users.flatMap((account) => paymentRowsFor(account, 'student')),
      ...teachers.flatMap((account) => paymentRowsFor(account, 'teacher')),
    ].sort((a, b) => new Date(b.paidAt || 0).getTime() - new Date(a.paidAt || 0).getTime());
    const summary = payments.reduce((acc, payment) => {
      acc.count += 1;
      acc.revenueInr += Number(payment.amountInr || 0);
      if (payment.isSchoolManaged) acc.schoolPayments += 1; else acc.individualPayments += 1;
      if (payment.source === 'manual' || payment.method === 'offline') acc.offlinePayments += 1; else acc.onlinePayments += 1;
      return acc;
    }, { count: 0, revenueInr: 0, schoolPayments: 0, individualPayments: 0, onlinePayments: 0, offlinePayments: 0 });
    return res.json({ success: true, summary, payments });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message || 'Could not load subscription payments.' });
  }
}
