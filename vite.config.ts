import { defineConfig, loadEnv } from 'vite';
import vue from '@vitejs/plugin-vue';
import { viteStaticCopy } from 'vite-plugin-static-copy';
import { resolve, join, dirname } from 'path';
import { copyFileSync, existsSync, mkdirSync } from 'fs';
import { inputPageConfig, createHMRPlugin, createFlatHtmlPlugin } from './src/config/page.config';
import { inputSourceConfig, copyFilesConfig } from './src/config/source.config';
import svgLoader from 'vite-svg-loader';
import type { OutputOptions } from 'rollup'
import { getBuildEdition, getViteAliases } from './scripts/vite-shared.mjs';


export default defineConfig(({mode})=>{
  const env = loadEnv(mode, process.cwd(), '');
  const mergedEnv = { ...process.env, ...env };
  const OUTPUT_DIR = env.VITE_OUTPUT_DIR;
  const PLATFORM_NAME = env.VITE_STAY_EXTENSION_PLATFORM_NAME;
  const BROWSER_NAME = env.VITE_STAY_EXTENSION_BROWSER_NAME;
  const BUILD_TYPE = env.BUILD_TYPE;
  const BUILD_EDITION = getBuildEdition(mergedEnv);
  const NODE_ENV = process.env.NODE_ENV;
  console.log("start build----OUTPUT_DIR=",OUTPUT_DIR, mode, BROWSER_NAME, "edition=", BUILD_EDITION);
  
  const inputSourceMap = inputSourceConfig(PLATFORM_NAME, BROWSER_NAME, BUILD_EDITION);
  const inputSourceKeys = Object.keys(inputSourceMap);
  // console.log("input source config----", inputSourceMap);
  const isDev = NODE_ENV === 'development' || BUILD_TYPE === 'dev';
  console.log("isDev----", isDev);
  const copyFilesTargets = copyFilesConfig(OUTPUT_DIR, PLATFORM_NAME, BROWSER_NAME, BUILD_EDITION);
  const isWatch = process.argv.includes('--watch');
  const isSafari = BROWSER_NAME === 'safari';
  // console.log("isWatch----", copyFilesTargets, isWatch);

  return {
    plugins: [
      vue({
        template: {
          compilerOptions: {
            // 自定义编译器选项
          }
        },
        include: [/\.vue$/, /\.md$/], 
      }),
      svgLoader(),
      createHMRPlugin(),
      // Safari：禁内联 script（CSP）→ 外置 popup/safari-panel-boot.js 挂 module。
      // Xcode 只 folder-ref 了 popup/assets/...，没有 sidepanel/ → 须把 Chat 入口拷进 popup/。
      isSafari
        ? {
            name: 'safari-iframe-html',
            transformIndexHtml(html: string) {
              const bootScript = '<script src="/popup/safari-panel-boot.js"></script>';
              let next = html
                .replace(/(src|href)=["']\.\.\/assets\//g, '$1="/assets/')
                .replace(/(src|href)=["']\.\/assets\//g, '$1="/assets/')
                .replace(/\s+crossorigin(?:=["'][^"']*["'])?/gi, '');
              next = next.replace(
                /<script\s+type=["']module["']\s+src=["']([^"']+)["']\s*><\/script>/i,
                '<script type="module" data-doma-defer="1" data-src="$1"></script>',
              );
              return next
                .replace(/<html([^>]*)>/i, '<html$1 style="height:100%;margin:0">')
                .replace(/<body([^>]*)>/i, `<body$1 style="height:100%;margin:0;overflow:hidden">${bootScript}`)
                .replace(
                  '<div id="app"></div>',
                  '<div id="app" style="height:100%;min-height:100%"></div>',
                );
            },
            closeBundle() {
              // Xcode Resources 含 popup/ 不含 sidepanel/ → Chat 入口必须落在 popup/
              const outDir = resolve(__dirname, OUTPUT_DIR || 'dist/desktop/pro_safari');
              const src = join(outDir, 'sidepanel/index.html');
              const dest = join(outDir, 'popup/sidepanel.html');
              try {
                if (existsSync(src)) {
                  mkdirSync(dirname(dest), { recursive: true });
                  copyFileSync(src, dest);
                  console.log('[safari] copied sidepanel → popup/sidepanel.html');
                } else {
                  console.warn('[safari] missing sidepanel/index.html, skip copy');
                }
              } catch (e) {
                console.warn('[safari] copy sidepanel into popup failed', e);
              }
            },
          }
        : null,
      viteStaticCopy({
        targets: copyFilesTargets,
        // 晚于 publicDir 拷贝，确保 favicon 以 src/assets/favicon.ico 为准
        hook: 'closeBundle',
      }),
    ].filter(Boolean),
    // Safari iframe 对齐 YouMind：base `/` → HTML 里是 /assets/... 而非 ../assets/...
    base: isSafari ? '/' : './',
    resolve: {
      alias: [
        // Safari：必须放在 getViteAliases 之前，挡住重模块进 ChatPanel 首包
        ...(isSafari
          ? [
              {
                find: '@/services/chat/browserTools',
                replacement: resolve(__dirname, 'src/services/chat/safariStubs/browserToolsLite.ts'),
              },
              {
                find: '@/services/chat/tabRecording',
                replacement: resolve(__dirname, 'src/services/chat/safariStubs/tabRecordingStub.ts'),
              },
            ]
          : []),
        ...getViteAliases(__dirname, mergedEnv),
      ],
      extensions: ['.mjs', '.js', '.ts', '.jsx', '.tsx', '.json', '.vue'],
    },
    publicDir: resolve(__dirname, 'public'),
    build: {
      // Safari：先关掉 terser，排除压缩导致的 WebKit 崩溃，优先让完整 ChatPanel 能挂上
      minify: isSafari ? false : (isDev ? false : "terser"),
      terserOptions: isSafari
        ? undefined
        : {
        compress: {
          // Safari iframe 白屏排查需要保留日志；Safari 包不要 drop_console
          drop_console: false,
          pure_funcs: ['console.log'],
        }
      },
      commonjsOptions: {
        transformMixedEsModules: true
      },
      target: 'esnext', // 保持现代语法
      // worker: {
      //   format: 'es',
      //   rollupOptions: {
      //     plugins: [],
      //     resolve: {
      //       alias: {
      //         '@': resolve(__dirname, 'src'),
      //       }
      //     }
      //   }
      // },
      outDir: OUTPUT_DIR,
      emptyOutDir: isDev ? false : true,
      rollupOptions: {
        input: {
          ...inputPageConfig,
          ...inputSourceMap,
        },
        output: {
          plugins: [
            createFlatHtmlPlugin()
          ] as OutputOptions['plugins'],
          //entryFileNames: 'assets/js/[name]-[hash].js',
          entryFileNames: (chunkInfo)=>{
            // entryFileNames 用于定义入口文件（也就是应用程序的初始加载文件）的输出文件名。
            // 入口文件通常是在 rollupOptions.input 中指定的文件。
            if (inputSourceKeys.some((input: string) => chunkInfo.facadeModuleId?.includes(input))) {
              return '[name].js';
            }else {
              // 非指定路径下的文件，保持原逻辑
              return 'assets/js/[name]-[hash].js';
            }
          },
          // chunkFileNames: 'assets/js/[name]-[hash].js',
          chunkFileNames: (chunkInfo) => {
            if (chunkInfo.name === 'vendor') return 'assets/js/vendor-[hash].js'
            return 'assets/js/[name]-[hash].js'
          },
          assetFileNames: (assetInfo): string => {
            // console.log("assetInfo-------", assetInfo);
            
            const assetNames = assetInfo.names as Array<string>;
            const assetName = (assetNames.length && assetNames[0] ) || '';
            const extType = assetName.split('.').pop()?.toLowerCase() ?? ''
            
            const dirMap: Record<string, string> = {
              png: 'images',
              jpg: 'images',
              jpeg: 'images',
              svg: 'images',
              gif: 'images',
              webp: 'images',
              woff: 'fonts',
              woff2: 'fonts',
              eot: 'fonts',
              ttf: 'fonts',
              otf: 'fonts',
              css: 'css',
              less: 'css',
              scss: 'css',
            }
            const dir = dirMap[extType] || 'css'
            // console.log("extType, dir----", extType, dir);
            // if (extType == "css") {
            //   return `assets/${dir}/vendor.[hash][extname]`
            // }
            return `assets/${dir}/[name].[hash][extname]`
          },
          manualChunks(id) {
            // content script 入口须单文件；html2canvas 不能拆到 vendor
            if (id.includes('html2canvas')) return undefined;
            // 只要是第三方依赖（node_modules），都打到一个 vendor.js 中
            if (id.includes('node_modules')) {
              if (id.includes('codemirror')) return 'codemirror';
              // Excel 导出按需加载，避免打进首屏 vendor
              if (id.includes('xlsx')) return 'xlsx';
              return 'vendor'
            }
            if (id.includes('i18n')) {
              return "vendor";
            }
            // 注意：不要把 /services/chat|/components/chat 再拆 manualChunks
            // Safari 上曾导致 vendor TDZ：Cannot access 'Ge' before initialization
            return undefined;
          },
          // manualChunks: undefined, // ✅ 不拆包
        },
        onwarn(warning, warn) {
          // 忽略 mime externalized 警告
          if (
            warning.message?.includes('Module "fs" has been externalized') ||
            warning.message?.includes('Module "path" has been externalized') ||
            warning.message?.includes('Module "node:')
          ) {
            return;
          }
          warn(warning); // 其他警告照常显示
        },
        // external: isWatch ? [/ffmpeg-core.worker\.js$/] : [],
      },
      watch: isWatch ? {
        clearScreen: false,
        include: ['src/**'],
        // exclude: ['node_modules/*', '**/ffmpeg/**', '**/ffmpeg-core*.js', "@ffmpeg/ffmpeg"]
      } : null,
    },
    // define: {
    //   // 定义全局变量，用于替换import.meta.url
    //   'import.meta.url': 'self.location'
    // },
    css: {
      preprocessorOptions: {
        less: {
          modifyVars: {
            edition: BUILD_EDITION === 'open' ? 'open' : 'pro',
          },
          javascriptEnabled: true, // 启用内联 JavaScript
        }
      },
      modules: {
        localsConvention: 'camelCaseOnly' as const,
      },
      postcss: {
        
      }
    },
    optimizeDeps: {
      include: ['vue', 'mux.js', 'mp4box'],
      exclude: ['fs', 'path', 'os'],
      esbuildOptions: {
        loader: {
          '.ts': 'tsx'
        }
      }
    },
    esbuild: {
      loader: 'tsx',
      include: /src\/.*\.tsx?$/,
      exclude: []
    },
    server: {
      port: 4000,
      headers: {
        "Access-Control-Allow-Origin": "*",
        'Content-Security-Policy': `style-src 'nonce-random' 'self'`,
      },
      // open: 'options/index.html', // 默认打开页面
      proxy: {
        "/v1/stay": {
          // target: "https://api.staybrowser.com", //请求对象
          target: "http://172.16.0.27:10000",
          ws: false, //代理websocked
          changeOrigin: true, // //用于控制请求头中的host值
          secure: true, //target是否为https接口
          // pathRewrite: { "^/stay-fork": "" }, //将所有含//stay-fork路径的，去掉/stay-fork转发给服务器
        },
      },
    }
  }
})