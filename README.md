# Welcome to your Expo app 👋

This is an [Expo](https://expo.dev) project created with [`create-expo-app`](https://www.npmjs.com/package/create-expo-app).

## Get started

1. Install dependencies

   ```bash
   npm install
   ```

   Create a local environment file before running the app:

   ```bash
   copy .env.example .env
   ```

   Fill in `EXPO_PUBLIC_SUPABASE_URL` and
   `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` from the Supabase project settings.
   The app intentionally falls back to a signed-out/local theme when these
   values are missing, so a fresh clone does not crash; authenticated features
   require the values to be configured locally.

2. Start the native mobile app with Expo CLI

   ```bash
   npx expo start
   ```

   If Expo Go cannot reach Metro from your phone, use tunnel mode instead:

   ```bash
   npm run start:tunnel
   ```

3. Start the browser app only when you want the web target

   ```bash
   npm run web
   ```

4. Build the static web export for Vercel

   ```bash
   npm run build
   ```

In the output, you'll find options to open the app in a

- [development build](https://docs.expo.dev/develop/development-builds/introduction/)
- [Android emulator](https://docs.expo.dev/workflow/android-studio-emulator/)
- [iOS simulator](https://docs.expo.dev/workflow/ios-simulator/)
- [Expo Go](https://expo.dev/go), a limited sandbox for trying out app development with Expo

You can start developing by editing the files inside the **app** directory. This project uses [file-based routing](https://docs.expo.dev/router/introduction).

## Mobile vs Vercel

- Expo Go connects to the local Expo development server started by `expo start`.
- Vercel serves the static web export from `dist`; it does not replace Metro for native mobile testing.
- Use Vercel for `npm run build` web hosting, and use `npx expo start` or `npm run start:tunnel` for Android and iPhone testing in Expo Go.

## Health checks

```bash
npm run doctor
```

## Get a fresh project

When you're ready, run:

```bash
npm run reset-project
```

This command will move the starter code to the **app-example** directory and create a blank **app** directory where you can start developing.

## Learn more

To learn more about developing your project with Expo, look at the following resources:

- [Expo documentation](https://docs.expo.dev/): Learn fundamentals, or go into advanced topics with our [guides](https://docs.expo.dev/guides).
- [Learn Expo tutorial](https://docs.expo.dev/tutorial/introduction/): Follow a step-by-step tutorial where you'll create a project that runs on Android, iOS, and the web.

## Project Notes

- Email verification and password reset use Supabase Auth.
- Resend/Supabase setup steps for Gmail delivery are documented in [docs/email-auth-setup.md](d:\react native projects\capstone\strandshare_capstone\docs\email-auth-setup.md).

## Join the community

Join our community of developers creating universal apps.

- [Expo on GitHub](https://github.com/expo/expo): View our open source platform and contribute.
- [Discord community](https://chat.expo.dev): Chat with Expo users and ask questions.
