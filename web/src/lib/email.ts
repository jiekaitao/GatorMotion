import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);

export async function sendInviteEmail({
  to,
  therapistName,
  inviteLink,
}: {
  to: string;
  therapistName: string;
  inviteLink: string;
}) {
  const { data, error } = await resend.emails.send({
    from: "GatorMove <onboarding@resend.dev>",
    to,
    subject: `${therapistName} invited you to GatorMove`,
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 480px; margin: 0 auto; padding: 32px 24px;">
        <h1 style="font-size: 28px; font-weight: 800; color: #3C3C3C; margin: 0 0 8px 0;">
          🐊 GatorMove
        </h1>
        <p style="font-size: 16px; color: #777777; margin: 0 0 32px 0;">
          Your physical therapy companion
        </p>

        <div style="background: #F7F7F7; border: 2px solid #E5E5E5; border-radius: 12px; padding: 24px; margin-bottom: 32px;">
          <p style="font-size: 18px; color: #3C3C3C; margin: 0 0 8px 0; font-weight: 700;">
            ${therapistName} has invited you!
          </p>
          <p style="font-size: 14px; color: #777777; margin: 0;">
            Your therapist wants you to join GatorMove to track your exercises, build streaks, and stay on top of your recovery.
          </p>
        </div>

        <a href="${inviteLink}" style="display: block; text-align: center; background: #58CC02; color: white; font-size: 16px; font-weight: 700; padding: 14px 24px; border-radius: 12px; text-decoration: none; border-bottom: 4px solid #46A302;">
          Create Your Account
        </a>

        <p style="font-size: 12px; color: #AFAFAF; margin: 24px 0 0 0; text-align: center;">
          This invite link expires in 7 days. If you didn't expect this email, you can ignore it.
        </p>
      </div>
    `,
  });

  if (error) {
    console.error("Failed to send invite email:", error);
    throw new Error("Failed to send email");
  }

  return data;
}
