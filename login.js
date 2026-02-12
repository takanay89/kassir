import { supabase } from './supabaseClient.js';

// Проверка сессии при загрузке
window.addEventListener('DOMContentLoaded', async () => {
  const { data } = await supabase.auth.getSession();
  if (data.session) {
    window.location.replace('index.html');
  }
});

window.switchAuthMode = function(mode) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.auth-form').forEach(f => f.classList.remove('active'));
  
  if (mode === 'login') {
    document.querySelector('.tab:first-child').classList.add('active');
    document.getElementById('loginForm').classList.add('active');
    document.getElementById('authTitle').textContent = 'Вход в систему';
  } else {
    document.querySelector('.tab:last-child').classList.add('active');
    document.getElementById('registerForm').classList.add('active');
    document.getElementById('authTitle').textContent = 'Регистрация';
  }
  
  hideError();
}

function showError(message) {
  const errorMsg = document.getElementById('errorMessage');
  errorMsg.textContent = message;
  errorMsg.classList.add('show');
}

function hideError() {
  document.getElementById('errorMessage').classList.remove('show');
}

window.handleLogin = async function(event) {
  event.preventDefault();
  hideError();

  const email = document.getElementById('loginEmail').value.trim();
  const password = document.getElementById('loginPassword').value;
  const btn = event.target.querySelector('button');

  btn.disabled = true;
  btn.textContent = 'Вход...';

  try {
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password
    });

    if (error) {
      showError(error.message);
      btn.disabled = false;
      btn.textContent = 'ВОЙТИ';
      return;
    }

    window.location.replace('index.html');

  } catch (err) {
    console.error('Login error:', err);
    showError('Ошибка подключения к серверу');
    btn.disabled = false;
    btn.textContent = 'ВОЙТИ';
  }
}

window.handleRegister = async function(event) {
  event.preventDefault();
  hideError();

  const companyName = document.getElementById('regCompanyName').value.trim();
  const email = document.getElementById('regEmail').value.trim();
  const password = document.getElementById('regPassword').value;
  const btn = event.target.querySelector('button');

  if (password.length < 6) {
    showError('Пароль должен быть минимум 6 символов');
    return;
  }

  if (!companyName) {
    showError('Укажите название компании');
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Регистрация...';

  try {
    // регистрация
    const { error: authError } = await supabase.auth.signUp({
      email,
      password
    });

    if (authError) {
      showError(authError.message);
      btn.disabled = false;
      btn.textContent = 'ЗАРЕГИСТРИРОВАТЬСЯ';
      return;
    }

    // создание компании
    const { error: companyError } = await supabase.rpc('create_company_with_owner', {
      p_company_name: companyName
    });

    if (companyError) {
      console.error('Company creation error:', companyError);
      showError('⚠️ Пользователь создан, но компания не создана. Обратитесь в поддержку.');
      btn.disabled = false;
      btn.textContent = 'ЗАРЕГИСТРИРОВАТЬСЯ';
      return;
    }

    showError('✅ Регистрация успешна! Теперь войдите.');
    document.getElementById('errorMessage').style.background = '#10b981';

    setTimeout(() => {
      window.switchAuthMode('login');
      document.getElementById('loginEmail').value = email;
    }, 2000);

  } catch (err) {
    console.error('Register error:', err);
    showError('Ошибка подключения к серверу');
    btn.disabled = false;
    btn.textContent = 'ЗАРЕГИСТРИРОВАТЬСЯ';
  }
}