<div align="center">

<img src="https://capsule-render.vercel.app/api?type=waving&color=0:101D2C,45:173B4A,100:287C78&height=230&section=header&text=COZYLAND&fontSize=72&fontColor=F3F0E8&fontAlignY=38&desc=Your%20creative%20space%20for%20audio%20and%20ideas&descAlignY=61&descSize=17&animation=fadeIn" width="100%" alt="Cozyland cinematic navy and teal banner"/>

### 🎙️ One idea. Two voices. A whole new way to explore.

**An AI-powered podcast and interactive 3D explainer studio.**

Create conversations, listen to ideas unfold, and explore complex topics through immersive audio-visual experiences.

<img src="https://img.shields.io/badge/AI-Google%20Gemini-8DAEAC?style=for-the-badge&labelColor=101D2C" alt="Google Gemini"/> <img src="https://img.shields.io/badge/FRONTEND-React%20%2B%20TypeScript-8DAEAC?style=for-the-badge&labelColor=101D2C" alt="React and TypeScript"/> <img src="https://img.shields.io/badge/BACKEND-Node%20%2B%20Express-D5D5C9?style=for-the-badge&labelColor=101D2C" alt="Node and Express"/> <img src="https://img.shields.io/badge/EXPERIENCE-Audio%20%2B%203D-287C78?style=for-the-badge&labelColor=101D2C" alt="Audio and 3D"/>

<sub>Built to make curiosity sound better and ideas feel closer.</sub>

</div>

---

## 🌌 Enter Cozyland

Cozyland turns a topic, question, article, or reference link into a two-host podcast experience — complete with AI-generated dialogue, natural-sounding speech, synchronized transcripts, custom cover artwork, and an interactive 3D explainer.

At the heart of the experience are **Riya and Arjun**, two AI podcast hosts who bring ideas to life through conversational storytelling. Listen to their discussion, follow every spoken turn, jump to moments in the audio, and explore the subject through a connected 3D scene.

Cozyland brings conversational AI, audio generation, visual storytelling, and interactive exploration together in one creative workspace.

> **The Cozyland idea:** learning should feel less like studying a page and more like getting pulled into a great conversation.

## ✨ Inside the studio

<table>
<tr>
<td width="50%" valign="top">
<h3>🎙️ AI Podcast Creation</h3>
Turn a topic, question, article, or URL into a structured conversation between two AI hosts. Configure the language, duration, and conversational style.
</td>
<td width="50%" valign="top">
<h3>🗣️ Two Host Personalities</h3>
Generate dialogue for Riya and Arjun, customize their voice settings, preview delivery, and save reusable voice presets.
</td>
</tr>
<tr>
<td width="50%" valign="top">
<h3>🎧 Generated Audio</h3>
Synthesize host speech, combine audio segments, monitor generation progress, and listen through the integrated player.
</td>
<td width="50%" valign="top">
<h3>📝 Synchronized Transcript</h3>
Follow each spoken turn with speaker and timing details. Select a transcript line to jump to that moment in the episode.
</td>
</tr>
<tr>
<td width="50%" valign="top">
<h3>🪐 Interactive 3D Explainers</h3>
Explore generated scenes with selectable nodes, connected concepts, labels, camera controls, and chapter-aware highlighting.
</td>
<td width="50%" valign="top">
<h3>🎨 Custom Cover Artwork</h3>
Generate episode cover artwork from the visual direction of the podcast and update it from the episode workspace.
</td>
</tr>
<tr>
<td width="50%" valign="top">
<h3>🌍 Multilingual Podcasts</h3>
Create podcast experiences across 14 supported languages and make ideas accessible to more listeners.
</td>
<td width="50%" valign="top">
<h3>💬 Episode Companion</h3>
Ask follow-up questions in the episode workspace and explore answers grounded in the generated episode and its sources.
</td>
</tr>
<tr>
<td width="50%" valign="top">
<h3>🎚️ Voice Studio</h3>
Tune voice delivery, expressiveness, and energy. Preview voices and manage reusable configurations.
</td>
<td width="50%" valign="top">
<h3>📚 Episode Library</h3>
Keep generated episodes together, revisit previous conversations, and continue exploring from the workspace.
</td>
</tr>
</table>

## 🧭 From a thought to a whole experience

| Step | The journey |
|:---:|---|
| **01 · Input** | Enter a topic, question, article, or reference URL. |
| **02 · Shape** | Choose the language, duration, and podcast style. |
| **03 · Generate** | Prepare the conversation, quality review, artwork direction, and 3D scene with Gemini-powered workflows. |
| **04 · Listen** | Synthesize host speech and assemble the episode audio. |
| **05 · Explore** | Follow the transcript, ask questions, and interact with the 3D explainer. |

<p align="center"><sub>A staged generation pipeline helps track progress and provides an audio retry path without restarting the entire creative process.</sub></p>

## 🧊 One workspace, different ways to create

- **Studio** — start a new episode and revisit recent creations.
- **Transcript** — listen, follow the synchronized dialogue, and ask episode-related questions.
- **3D Explorer** — inspect the generated scene and explore connected concepts.
- **Voice Studio** — customize host voices, preview delivery, and manage voice profiles.
- **Library** — return to saved episodes.
- **Settings** — manage workspace preferences.

The interface includes light and dark themes. Preferences such as language, duration, style, and host voice configuration are stored locally in the browser.

## ⚙️ Technology stack

| Area | Tools and technologies |
|---|---|
| **Frontend** | React 19 · TypeScript · Vite |
| **AI integration** | Google Gemini API · @google/genai |
| **Audio** | Gemini text-to-speech · Browser Audio APIs |
| **3D experience** | Three.js · WebGL · OrbitControls |
| **Interface & motion** | Tailwind CSS · Motion · Lucide React |
| **Backend** | Node.js · Express · TypeScript |
| **Validation & uploads** | Zod · Multer |
| **Development** | Bun · TSX |

## 🏗️ Project structure

```text
Cozyland/
├── server/
│   ├── ai.ts                  # Gemini client and AI utilities
│   ├── podcastPipeline.ts     # Podcast generation pipeline
│   ├── security.ts            # Server-side security helpers
│   └── storage.ts             # Episode and voice-profile storage
│
├── src/
│   ├── assets/images/         # Studio and host artwork
│   ├── components/
│   │   ├── AudioPlayerBar.tsx
│   │   ├── CoverArtwork.tsx
│   │   ├── Explainer3D.tsx
│   │   ├── LibrarySettingsViews.tsx
│   │   ├── StudioCreateView.tsx
│   │   ├── TranscriptChatView.tsx
│   │   └── VoiceStudioView.tsx
│   ├── lib/api.ts             # Client API helpers
│   ├── types/podcast.ts       # Shared podcast types
│   ├── App.tsx                # Main application workspace
│   ├── index.css
│   └── main.tsx
│
├── .env.example
├── index.html
├── package.json
├── server.ts                 # Express app and API routes
├── tsconfig.json
└── vite.config.ts
```

## 🚀 Run it locally

### 1. Clone the repository

```bash
git clone https://github.com/Kevin-S1608/Cozyland---Studio.git
cd Cozyland---Studio
```

### 2. Install dependencies

Bun is the recommended package manager for this project.

```bash
bun install
```

### 3. Add your environment variables

Create a `.env` file in the project root and configure your Gemini API key:

```env
GEMINI_API_KEY=your_gemini_api_key
APP_URL=http://localhost:3000
```

Create or manage a key in [Google AI Studio](https://aistudio.google.com/app/apikey). Keep the real key private: never commit `.env` or expose server credentials in frontend code.

### 4. Start the development server

```bash
bun run dev
```

Open the local URL printed by the development server.

### 5. Build and check

```bash
bun run build
bun run lint
```

## 🔐 Security and responsible use

- Store Gemini credentials in server-side environment variables or your hosting provider’s secret manager.
- Never commit API keys, private recordings, or personal data.
- Only upload voice recordings you own or are explicitly authorized to use.
- Confirm the required voice authorization consent before submitting a custom voice sample.
- Review generated content before publishing or sharing it.

## 🗺️ What is ahead

Cozyland is an evolving creative project. Future improvements are focused on:

- A smoother and more resilient generation and playback workflow.
- More expressive podcast styles and voice controls.
- Richer interactive 3D scenes and learning experiences.
- Better episode organization and sharing.
- A polished, dependable deployment experience.

## 🤝 Contributing

Ideas, bug reports, and thoughtful improvements are welcome.

1. Fork the repository.
2. Create a branch: `git checkout -b feature/your-improvement`.
3. Commit your changes: `git commit -m "Add your improvement"`.
4. Push your branch: `git push origin feature/your-improvement`.
5. Open a pull request describing your changes.

## 📜 License

No license file is currently included in this repository. Until a license is added, standard copyright applies; reuse and redistribution are not automatically permitted.

---

<div align="center">
<img src="https://capsule-render.vercel.app/api?type=waving&color=0:287C78,55:173B4A,100:101D2C&height=155&section=footer" width="100%" alt="Cozyland teal and midnight blue footer"/>

## 🌌 Make room for curiosity.

**Cozyland** — a little space for big ideas.

[Explore the repository](https://github.com/Kevin-S1608/Cozyland---Studio) · [Google AI Studio](https://aistudio.google.com/)

<sub>Made with curiosity, creativity, and a little help from AI. ✨</sub>
</div>
