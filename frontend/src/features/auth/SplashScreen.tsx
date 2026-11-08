export function SplashScreen() {
  return (
    <div className="pitch-gradient grid min-h-dvh place-items-center" role="status" aria-label="Loading CricketMarvels Play">
      <div className="flex flex-col items-center gap-4 text-white">
        <div className="relative">
          <img src="/icon.svg" alt="" className="size-20 animate-[spin_3s_linear_infinite] rounded-3xl" />
        </div>
        <p className="font-display text-2xl font-extrabold">CricketMarvels <span className="text-ball-500">Play</span></p>
        <p className="text-sm text-white/70">Your next match is nearby</p>
      </div>
    </div>
  );
}
