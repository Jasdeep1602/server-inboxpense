import { Router, Request, Response } from 'express';
import { authMiddleware } from '../middleware/auth.middleware';
import { google } from 'googleapis';
import { XMLParser } from 'fast-xml-parser';
import UserModel from '../models/user.model';
import TransactionModel from '../models/transaction.model';

const router = Router();

/**
 * Extracts transaction data from a list of SMS objects.
 * @param smsList - An array of SMS objects from the parsed XML.
 * @param source - The source profile name (e.g., 'Mom', 'Dad').
 * @returns An array of structured transaction data.
 */
function extractTransactionsFromSMS(smsList: any[], source: string) {
  const transactions = [];
  const amountRegex =
    /(?:credited(?:\s+with)?|debited(?:\s+by)?|spent|withdrawn|paid|received|purchase(?:\s+of)?|deposited|transferred|sent|added|deducted|reversed|refunded|failed|unsuccessful)[^₹Rs\d]*(?:INR|Rs\.?|₹)?\s*([\d,]+(?:\.\d{1,2})?)(?!\d)/i;
  const upiIdRegex = /\b[\w.-]+@[\w.-]+\b/i;
  const cardRegex = /\b(?:Card\s+\*\*\d{4}|credit card|debit card)\b/i;
  const bankRegex = /\b(?:A\/c\s+\w+|A\/c\s+XX\d+|account\s+number)\b/i;
  const failedRegex = /\b(failed|reversed|refund(?:ed)?|unsuccessful)\b/i;

  const upiAppPatterns: { [key: string]: RegExp } = {
    GPay: /\b(Google Pay|GPay|okgoogle)\b|@okgoogle/i,
    PhonePe: /\b(PhonePe|okphonepe)\b|@ybl/i,
    Paytm: /\b(Paytm|okpaytm)\b|@paytm/i,
  };

  for (const sms of smsList) {
    const body = (sms['@_body'] || '').replace(/\s+/g, ' ').trim();
    const smsDate = sms['@_date'];
    if (!body || !smsDate) continue;

    const amountMatch = body.match(amountRegex);
    if (!amountMatch) continue;

    const amount = parseFloat(amountMatch[1].replace(/,/g, ''));
    if (isNaN(amount)) continue;

    const type = /credited|received/i.test(body) ? 'credit' : 'debit';
    let mode = 'UPI';
    for (const [app, pattern] of Object.entries(upiAppPatterns)) {
      if (pattern.test(body)) {
        mode = app;
        break;
      }
    }
    if (mode === 'UPI' && upiIdRegex.test(body)) {
    } else if (mode === 'UPI') {
      if (cardRegex.test(body)) mode = 'Card';
      else if (bankRegex.test(body)) mode = 'Bank';
      else mode = 'Other';
    }

    transactions.push({
      smsId: smsDate,
      date: new Date(parseInt(smsDate)),
      body,
      amount,
      type,
      mode,
      source,
      status: failedRegex.test(body) ? 'failed' : 'success',
    });
  }
  return transactions;
}

// The route handler now uses the standard Request and Response types
router.post(
  '/sync/drive',
  authMiddleware,
  async (req: Request, res: Response) => {
    const { source } = req.body;
    // The middleware guarantees that req.auth exists if we reach this point
    const userId = req.auth!.sub;

    if (!source) {
      return res
        .status(400)
        .json({ message: 'Source folder name is required.' });
    }

    try {
      // Fetch the user from the database using the ID from the JWT.
      const user = await UserModel.findById(userId);
      if (!user || !user.googleRefreshToken) {
        return res
          .status(401)
          .json({
            message:
              'User not found or Google refresh token is missing. Please re-authenticate.',
          });
      }

      const oauth2Client = new google.auth.OAuth2(
        process.env.GOOGLE_CLIENT_ID,
        process.env.GOOGLE_CLIENT_SECRET,
        process.env.GOOGLE_CALLBACK_URL
      );
      oauth2Client.setCredentials({ refresh_token: user.googleRefreshToken });
      const drive = google.drive({ version: 'v3', auth: oauth2Client });

      // ... (The rest of the logic remains unchanged and is correct) ...
      const folderRes = await drive.files.list({
        q: `mimeType='application/vnd.google-apps.folder' and name='${source}' and trashed = false`,
        fields: 'files(id)',
        spaces: 'drive',
      });
      const folderId = folderRes.data.files?.[0]?.id;
      if (!folderId) {
        return res
          .status(404)
          .json({ message: `Folder '${source}' not found in Google Drive.` });
      }

      const fileRes = await drive.files.list({
        q: `'${folderId}' in parents and name contains 'sms-' and name contains '.xml' and trashed = false`,
        orderBy: 'name desc',
        pageSize: 1,
        fields: 'files(id, name)',
      });
      const latestFile = fileRes.data.files?.[0];
      if (!latestFile || !latestFile.id) {
        return res
          .status(404)
          .json({ message: `No SMS backup file found in folder '${source}'.` });
      }

      const fileContentRes = await drive.files.get({
        fileId: latestFile.id,
        alt: 'media',
      });

      const parser = new XMLParser({
        ignoreAttributes: false,
        attributeNamePrefix: '@_',
      });
      const parsedXml = parser.parse(fileContentRes.data as string);
      const smsList = parsedXml?.smses?.sms || [];
      const transactions = extractTransactionsFromSMS(smsList, source);
      if (transactions.length === 0) {
        return res.json({
          message: `Sync complete. No transactions found in file '${latestFile.name}'.`,
        });
      }

      const operations = transactions.map((tx) => ({
        updateOne: {
          filter: { userId, source: tx.source, smsId: tx.smsId },
          update: { $set: { ...tx, userId } },
          upsert: true,
        },
      }));
      const result = await TransactionModel.bulkWrite(operations);

      res.status(200).json({
        message: `Sync complete for '${source}'.`,
        fileName: latestFile.name,
        totalFound: transactions.length,
        newlyAdded: result.upsertedCount,
        modified: result.modifiedCount,
      });
    } catch (error: any) {
      console.error('Drive Sync Error:', error);
      if (error.response?.data?.error === 'invalid_grant') {
        return res
          .status(401)
          .json({
            message:
              'Authentication error with Google. The token might be revoked. Please re-authenticate.',
          });
      }
      res
        .status(500)
        .json({ message: 'An internal server error occurred during sync.' });
    }
  }
);

export default router;
