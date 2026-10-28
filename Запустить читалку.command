#!/bin/bash
# Запуск локальной читалки Audioplayer двойным кликом.
# Окно НЕ закрывать, пока читаешь. Чтобы остановить — закрой это окно.
cd "$(dirname "$0")" || { echo "Не нашёл папку проекта"; read -r -p "Enter"; exit 1; }

# Двойной клик в Finder не наследует твой PATH — подтягиваем node/npm вручную.
export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.local/bin:$PATH"
[ -s "$HOME/.nvm/nvm.sh" ] && . "$HOME/.nvm/nvm.sh" >/dev/null 2>&1
[ -s "$HOME/.fnm/fnm" ] && eval "$("$HOME/.fnm/fnm" env)" >/dev/null 2>&1

if ! command -v node >/dev/null 2>&1; then
  echo "❌ Node не найден в этом окружении."
  echo "   Открой обычный Терминал и выполни: which node ; node -v"
  echo "   Если node есть — напиши мне путь, поправлю запускалку."
  read -r -p "Enter для выхода"; exit 1
fi
echo "✅ node $(node -v), npm $(npm -v)"

# Уже запущено? Просто открыть вкладку.
if curl -sf -o /dev/null http://localhost:3000 2>/dev/null; then
  echo "Читалка уже работает — открываю вкладку."
  open http://localhost:3000
  read -r -p "Готово. Enter для выхода"; exit 0
fi

echo "Проверяю зависимости (npm install)…"
npm install || { echo "❌ npm install не прошёл (см. ошибки выше)"; read -r -p "Enter"; exit 1; }

echo "Поднимаю читалку…"
npm run dev &
DEV=$!

for _ in $(seq 1 45); do
  curl -sf -o /dev/null http://localhost:3000 2>/dev/null && break
  # если процесс dev уже умер — покажем ошибку и не будем крутить зря
  kill -0 "$DEV" 2>/dev/null || { echo "❌ Сервер не стартовал — ошибка выше."; read -r -p "Enter"; exit 1; }
  sleep 1
done

if curl -sf -o /dev/null http://localhost:3000 2>/dev/null; then
  echo "✅ Готово. Открываю http://localhost:3000"
  open http://localhost:3000
else
  echo "⚠️ Сервер поднимается дольше обычного. Попробуй вручную открыть http://localhost:3000"
fi

echo ""
echo "Окно держит сервер живым. Чтобы остановить читалку — закрой это окно."
wait $DEV
