/**
 * Multi-Language & Framework Project Stack Auto-Detector
 * Inspects directory layout, file trees, and package manifests to automatically determine language & framework.
 */

export function detectProjectStack(fileList = [], packageJsonContent = null, composerJsonContent = null) {
  const files = fileList.map(f => f.toLowerCase().trim())
  const hasFile = (pattern) => files.some(f => f === pattern || f.endsWith('/' + pattern) || f.includes(pattern))

  let language = 'static'
  let framework = 'Static HTML / Web App'
  let nginxType = 'static' // 'static' | 'proxy' | 'php-fpm'
  let buildCmd = ''
  let startCmd = ''
  let defaultPort = 5050
  let webRootSubdir = ''
  let icon = 'globe'

  // 1. Check PHP Projects
  if (hasFile('composer.json') || hasFile('artisan') || hasFile('wp-config.php') || hasFile('index.php') || composerJsonContent) {
    language = 'php'
    nginxType = 'php-fpm'

    if (hasFile('artisan') || (composerJsonContent && JSON.stringify(composerJsonContent).includes('laravel/framework'))) {
      framework = 'PHP Laravel'
      webRootSubdir = 'public'
      buildCmd = 'composer install --no-interaction --prefer-dist --optimize-autoloader'
      startCmd = 'php-fpm'
      icon = 'php'
    } else if (hasFile('wp-config.php') || hasFile('wp-content')) {
      framework = 'WordPress CMS'
      webRootSubdir = ''
      buildCmd = 'echo "WordPress static/dynamic asset ready"'
      startCmd = 'php-fpm'
      icon = 'wordpress'
    } else if (composerJsonContent && JSON.stringify(composerJsonContent).includes('symfony/framework-bundle')) {
      framework = 'PHP Symfony'
      webRootSubdir = 'public'
      buildCmd = 'composer install --no-interaction --prefer-dist --optimize-autoloader'
      startCmd = 'php-fpm'
      icon = 'php'
    } else if (hasFile('composer.json')) {
      framework = 'PHP Composer App'
      webRootSubdir = hasFile('public/index.php') ? 'public' : ''
      buildCmd = 'composer install --no-interaction --prefer-dist'
      startCmd = 'php-fpm'
      icon = 'php'
    } else {
      framework = 'Plain PHP Web App'
      webRootSubdir = ''
      buildCmd = 'echo "Plain PHP ready"'
      startCmd = 'php-fpm'
      icon = 'php'
    }

    return {
      language,
      framework,
      nginxType,
      buildCmd,
      startCmd,
      defaultPort,
      webRootSubdir,
      icon,
      isBackend: true,
      requiresPm2: false,
      requiresPhpFpm: true
    }
  }

  // 2. Check Python Projects
  if (hasFile('requirements.txt') || hasFile('manage.py') || hasFile('pipfile') || hasFile('pyproject.toml') || hasFile('app.py') || hasFile('main.py')) {
    language = 'python'
    nginxType = 'proxy'
    defaultPort = 8000

    if (hasFile('manage.py')) {
      framework = 'Python Django'
      buildCmd = 'python3 -m venv venv && source venv/bin/activate && pip install -r requirements.txt && python manage.py migrate --noinput || true'
      startCmd = 'gunicorn --bind 127.0.0.1:$PORT'
    } else if (hasFile('main.py') && (files.some(f => f.includes('fastapi')) || hasFile('requirements.txt'))) {
      framework = 'Python FastAPI'
      buildCmd = 'python3 -m venv venv && source venv/bin/activate && pip install -r requirements.txt'
      startCmd = 'uvicorn main:app --host 127.0.0.1 --port $PORT'
    } else {
      framework = 'Python Flask / Web App'
      buildCmd = 'python3 -m venv venv && source venv/bin/activate && pip install -r requirements.txt'
      startCmd = 'gunicorn app:app --bind 127.0.0.1:$PORT'
    }

    return {
      language,
      framework,
      nginxType,
      buildCmd,
      startCmd,
      defaultPort,
      webRootSubdir: '',
      icon: 'python',
      isBackend: true,
      requiresPm2: true,
      requiresPhpFpm: false
    }
  }

  // 3. Check Go (Golang) Projects
  if (hasFile('go.mod') || hasFile('main.go')) {
    language = 'golang'
    framework = 'Go (Golang)'
    nginxType = 'proxy'
    defaultPort = 8080
    buildCmd = 'go build -o server_binary .'
    startCmd = './server_binary'

    return {
      language,
      framework,
      nginxType,
      buildCmd,
      startCmd,
      defaultPort,
      webRootSubdir: '',
      icon: 'code',
      isBackend: true,
      requiresPm2: true,
      requiresPhpFpm: false
    }
  }

  // 4. Check Java (Spring Boot) Projects
  if (hasFile('pom.xml') || hasFile('build.gradle')) {
    language = 'java'
    framework = hasFile('pom.xml') ? 'Java Spring Boot (Maven)' : 'Java Spring Boot (Gradle)'
    nginxType = 'proxy'
    defaultPort = 8080
    buildCmd = hasFile('pom.xml') ? './mvnw clean package -DskipTests || mvn clean package -DskipTests' : './gradlew build -x test'
    startCmd = 'java -jar target/*.jar --server.port=$PORT || java -jar build/libs/*.jar --server.port=$PORT'

    return {
      language,
      framework,
      nginxType,
      buildCmd,
      startCmd,
      defaultPort,
      webRootSubdir: '',
      icon: 'coffee',
      isBackend: true,
      requiresPm2: true,
      requiresPhpFpm: false
    }
  }

  // 5. Check Ruby Projects
  if (hasFile('gemfile') || hasFile('config.ru')) {
    language = 'ruby'
    framework = hasFile('config.ru') ? 'Ruby on Rails' : 'Ruby Sinatra'
    nginxType = 'proxy'
    defaultPort = 3000
    buildCmd = 'bundle install'
    startCmd = 'bundle exec puma -p $PORT'

    return {
      language,
      framework,
      nginxType,
      buildCmd,
      startCmd,
      defaultPort,
      webRootSubdir: '',
      icon: 'gem',
      isBackend: true,
      requiresPm2: true,
      requiresPhpFpm: false
    }
  }

  // 6. Check Node.js / React / Next.js Projects
  if (hasFile('package.json') || packageJsonContent) {
    language = 'nodejs'
    let pkgString = ''
    if (packageJsonContent) {
      try {
        pkgString = JSON.stringify(packageJsonContent).toLowerCase()
      } catch (e) {}
    }

    if (pkgString.includes('"next"') || hasFile('next.config.js') || hasFile('next.config.mjs')) {
      framework = 'Next.js (SSR React)'
      nginxType = 'proxy'
      defaultPort = 3000
      buildCmd = 'npm install --legacy-peer-deps && npm run build'
      startCmd = 'npm run start -- -p $PORT'
      return {
        language,
        framework,
        nginxType,
        buildCmd,
        startCmd,
        defaultPort,
        webRootSubdir: '',
        icon: 'react',
        isBackend: true,
        requiresPm2: true
      }
    }

    if (pkgString.includes('"express"') || pkgString.includes('"@nestjs/core"') || pkgString.includes('"fastify"') || hasFile('server.js') || hasFile('app.js')) {
      framework = pkgString.includes('"@nestjs/core"') ? 'NestJS Backend' : 'Node.js Express'
      nginxType = 'proxy'
      defaultPort = 5050
      buildCmd = 'npm install --legacy-peer-deps'
      startCmd = 'node server.js || node index.js || node dist/main.js'
      return {
        language,
        framework,
        nginxType,
        buildCmd,
        startCmd,
        defaultPort,
        webRootSubdir: '',
        icon: 'node',
        isBackend: true,
        requiresPm2: true
      }
    }

    // Default Node Frontend SPA (React, Vue, Vite, Svelte, Angular)
    if (pkgString.includes('"react"') || pkgString.includes('"vue"') || pkgString.includes('"vite"') || pkgString.includes('"angular"')) {
      framework = pkgString.includes('"vite"') ? 'Vite Web App' : (pkgString.includes('"vue"') ? 'Vue.js App' : 'React.js SPA')
    } else {
      framework = 'Node.js Web App'
    }

    nginxType = 'static'
    buildCmd = 'npm install --legacy-peer-deps && npm run build'
    startCmd = 'static-nginx'
    webRootSubdir = hasFile('dist') ? 'dist' : (hasFile('build') ? 'build' : 'public')

    return {
      language,
      framework,
      nginxType,
      buildCmd,
      startCmd,
      defaultPort,
      webRootSubdir,
      icon: 'react',
      isBackend: false,
      requiresPm2: false
    }
  }

  // 7. Fallback Static HTML App
  return {
    language: 'static',
    framework: 'Static HTML Web App',
    nginxType: 'static',
    buildCmd: 'echo "Static site ready"',
    startCmd: 'static-nginx',
    defaultPort,
    webRootSubdir: '',
    icon: 'globe',
    isBackend: false,
    requiresPm2: false
  }
}
