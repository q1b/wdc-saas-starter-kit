import { GitHub, Google } from "arctic";
import { database } from "@/db";
import {
  encodeBase32LowerCaseNoPadding,
  encodeHexLowerCase,
} from "@oslojs/encoding";
import { Session, sessions, User, users } from "@/db/schema";
import { env } from "@/env";
import { eq } from "drizzle-orm";
import { sha256 } from "@oslojs/crypto/sha2";
import { UserId } from "./use-cases/types";
import { getSessionToken } from "./lib/session";
const SESSION_REFRESH_PERIOD = 1000 * 60 * 60 * 24 * 15;
const SESSION_EXTEND_TIME = SESSION_REFRESH_PERIOD * 2;

// export const lucia = new Lucia(adapter, {
//   sessionCookie: {
//     expires: false,
//     attributes: {
//       secure: process.env.NODE_ENV === "production",
//     },
//   },
//   getUserAttributes: (attributes) => {
//     return {
//       id: attributes.id,
//     };
//   },
// });

// export const validateRequest = async (): Promise<
//   { user: User; session: Session } | { user: null; session: null }
// > => {
//   const sessionId = cookies().get(lucia.sessionCookieName)?.value ?? null;
//   if (!sessionId) {
//     return {
//       user: null,
//       session: null,
//     };
//   }

//   const result = await lucia.validateSession(sessionId);

//   // next.js throws when you attempt to set cookie when rendering page
//   try {
//     if (result.session && result.session.fresh) {
//       const sessionCookie = lucia.createSessionCookie(result.session.id);
//       cookies().set(
//         sessionCookie.name,
//         sessionCookie.value,
//         sessionCookie.attributes
//       );
//     }
//     if (!result.session) {
//       const sessionCookie = lucia.createBlankSessionCookie();
//       cookies().set(
//         sessionCookie.name,
//         sessionCookie.value,
//         sessionCookie.attributes
//       );
//     }
//   } catch {}
//   return result;
// };

// declare module "lucia" {
//   interface Register {
//     Lucia: typeof lucia;
//     DatabaseUserAttributes: {
//       id: CustomUserId;
//     };
//     UserId: CustomUserId;
//   }
// }

export const github = new GitHub(
  env.GITHUB_CLIENT_ID,
  env.GITHUB_CLIENT_SECRET
);

export const googleAuth = new Google(
  env.GOOGLE_CLIENT_ID,
  env.GOOGLE_CLIENT_SECRET,
  `${env.HOST_NAME}/api/login/google/callback`
);

export function generateSessionToken(): string {
  const bytes = new Uint8Array(20);
  crypto.getRandomValues(bytes);
  const token = encodeBase32LowerCaseNoPadding(bytes);
  return token;
}

export async function createSession(
  token: string,
  userId: number
): Promise<Session> {
  const sessionId = encodeHexLowerCase(sha256(new TextEncoder().encode(token)));
  const session: Session = {
    id: sessionId,
    userId,
    expiresAt: new Date(Date.now() + SESSION_EXTEND_TIME),
  };
  await database.insert(sessions).values(session);
  return session;
}

export async function validateRequest(): Promise<SessionValidationResult> {
  const sessionToken = getSessionToken();
  if (!sessionToken) {
    return { session: null, user: null };
  }
  return validateSessionToken(sessionToken);
}

export async function validateSessionToken(
  token: string
): Promise<SessionValidationResult> {
  console.log("token", token);
  const sessionId = encodeHexLowerCase(sha256(new TextEncoder().encode(token)));
  console.log("sessionId", sessionId);
  const sessionInDb = await database.query.sessions.findFirst({
    where: eq(sessions.id, sessionId),
  });
  console.log("sessionInDb", sessionInDb);
  if (!sessionInDb) {
    return { session: null, user: null };
  }
  if (Date.now() >= sessionInDb.expiresAt.getTime()) {
    await database.delete(sessions).where(eq(sessions.id, sessionInDb.id));
    return { session: null, user: null };
  }
  const user = await database.query.users.findFirst({
    where: eq(users.id, sessionInDb.userId),
  });

  if (!user) {
    await database.delete(sessions).where(eq(sessions.id, sessionInDb.id));
    return { session: null, user: null };
  }

  if (Date.now() >= sessionInDb.expiresAt.getTime() - SESSION_REFRESH_PERIOD) {
    sessionInDb.expiresAt = new Date(Date.now() + SESSION_EXTEND_TIME);
    await database
      .update(sessions)
      .set({
        expiresAt: sessionInDb.expiresAt,
      })
      .where(eq(sessions.id, sessionInDb.id));
  }
  return { session: sessionInDb, user };
}

export async function invalidateSession(sessionId: string): Promise<void> {
  await database.delete(sessions).where(eq(sessions.id, sessionId));
}

export async function invalidateUserSessions(userId: UserId): Promise<void> {
  await database.delete(sessions).where(eq(users.id, userId));
}

export type SessionValidationResult =
  | { session: Session; user: User }
  | { session: null; user: null };
