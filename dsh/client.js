// Browser half of dsh-vision-picker: a settings card (settings.general.item)
// that lists the models resolved from the user's DSH providers, lets them
// pick one (writes modlens config), and per-model proxy overrides.
// Plus the race section: manage a roster of vision models that read every
// image in parallel (first success wins) via ~/.modlens/race.mjs.
// Native HTML only — no dsh-client-ui-primitives dependency.
window.__ModuleLoader__.load({
  id: 'dsh-vision-picker',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports

    var TEXT = {
      title: '视觉模型挑选（Vision Picker）',
      subtitle: '挑一个看图模型 + 单独给某模型设代理 + 多模型竞速看图，自动写入 modlens 配置。',
      loading: '加载中…',
      empty: '没扫到模型。检查 ~/.dsh/settings.yaml 的 llm-pi-ai.providers。',
      pick: '用这个',
      current: '当前',
      picked: '已切换',
      noKey: '无Key',
      hasKey: '有Key',
      refresh: '刷新',
      proxyLabel: '代理',
      proxyPlaceholder: 'http://127.0.0.1:10808（留空=直连）',
      saveProxy: '存代理',
      clearProxy: '清除',
      proxySaved: '代理已存',
      // race
      raceTitle: '竞速看图（多模型同时看，谁快用谁）',
      raceAdd: '+竞速',
      raceIn: '已参赛',
      raceRemove: '移出',
      raceTest: '测试',
      raceTesting: '测试中…',
      raceOk: '可用',
      raceFail: '不可用',
      raceEmpty: '还没有参赛模型。点上面模型行的「+竞速」，或在下面添加自定义端点。',
      raceTimeout: '超时ms',
      raceStagger: '梯队间隔ms',
      raceSaveSettings: '存设置',
      raceTest: '测试竞速',
      raceTestAll: '全部测试',
      readToolLabel: 'modlens_read_image（单模型直连备用）',
      readToolOn: '已开启',
      readToolOff: '已关闭',
      readToolEnable: '开启',
      readToolDisable: '关闭',
      readToolHintOn: '开启后模型也可以选它直连单个模型看图（不走竞速）',
      readToolHintOff: '关闭后看图只走 vision_race 竞速；模型调用它会收到改走竞速的提示',
      raceTesting: '竞速测试中…（可能要等约 1 分钟）',
      raceWinner: '🏆 胜者',
      raceCustom: '自定义 racer（OpenAI 兼容端点）',
      raceCustomBase: 'https://api.example.com/v1（必填）',
      raceCustomModel: '模型名，如 glm-5.2（必填）',
      raceCustomKey: 'API Key（必填）',
      raceCustomProxy: '代理（选填）',
      raceAddCustom: '添加 racer',
    }

    function Card(react) {
      var h = react.createElement

      var chevron = function (open) {
        return h(
          'svg',
          {
            width: 16,
            height: 16,
            viewBox: '0 0 16 16',
            style: {
              color: 'rgba(127,127,127,0.8)',
              flex: 'none',
              transition: 'transform .16s',
              transform: open ? 'rotate(180deg)' : 'none',
            },
          },
          h('path', {
            d: 'M4 6l4 4 4-4',
            fill: 'none',
            stroke: 'currentColor',
            strokeWidth: 1.5,
            strokeLinecap: 'round',
            strokeLinejoin: 'round',
          }),
        )
      }

      var smallBtn = function (label, opts, onClick, disabled) {
        return h(
          'button',
          {
            type: 'button',
            disabled: !!disabled,
            onClick: onClick,
            style: {
              font: 'inherit',
              fontSize: '12px',
              cursor: disabled ? 'default' : 'pointer',
              border: '1px solid rgba(127,127,127,0.35)',
              borderRadius: '6px',
              padding: '3px 10px',
              background: 'none',
              color: 'inherit',
              opacity: disabled ? 0.4 : 1,
              flex: 'none',
            },
          },
          label,
        )
      }

      var inputStyle = {
        flex: 1,
        minWidth: 0,
        font: 'inherit',
        fontSize: '12px',
        padding: '4px 8px',
        borderRadius: '6px',
        border: '1px solid rgba(127,127,127,0.35)',
        background: 'transparent',
        color: 'inherit',
      }

      // Per-model row: model info + "use this" + "+race" + a proxy input row.
      function ModelRow(props) {
        var m = props.m
        var isActive = props.isActive
        var inRace = props.inRace
        var onApply = props.onApply
        var onSetProxy = props.onSetProxy
        var onAddRace = props.onAddRace
        var proxyState = react.useState(m.proxy || '')
        var proxy = proxyState[0]
        var setProxy = proxyState[1]
        var busyState = react.useState(false)
        var busy = busyState[0]

        var proxyRow = h(
          'div',
          {
            style: {
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '4px 0 8px 0',
              borderTop: '1px dashed rgba(127,127,127,0.2)',
            },
          },
          h('span', { style: { fontSize: '12px', color: 'rgba(127,127,127,0.85)', flex: 'none' } }, TEXT.proxyLabel),
          h('input', {
            type: 'text',
            value: proxy,
            placeholder: TEXT.proxyPlaceholder,
            onChange: function (e) {
              if (!busy) setProxy(e.target.value)
            },
            style: inputStyle,
          }),
          smallBtn(
            TEXT.saveProxy,
            {},
            function () {
              busyState[1](true)
              onSetProxy(m, proxy.trim())
                .then(function () {
                  busyState[1](false)
                })
                .catch(function () {
                  busyState[1](false)
                })
            },
            busy,
          ),
          smallBtn(
            TEXT.clearProxy,
            {},
            function () {
              busyState[1](true)
              onSetProxy(m, '')
                .then(function () {
                  setProxy('')
                  busyState[1](false)
                })
                .catch(function () {
                  busyState[1](false)
                })
            },
            busy || proxy === '',
          ),
        )

        return h(
          'div',
          { style: { padding: '8px 0', borderTop: '1px solid rgba(127,127,127,0.25)' } },
          h(
            'div',
            { style: { display: 'flex', alignItems: 'center', gap: '8px' } },
            h(
              'div',
              { style: { flex: 1, minWidth: 0 } },
              h('div', { style: { fontSize: '13px', fontWeight: isActive ? 600 : 400 } }, m.model),
              h(
                'div',
                { style: { fontSize: '12px', color: 'rgba(127,127,127,0.85)' } },
                m.provider + ' · ' + m.baseUrl,
              ),
            ),
            h(
              'span',
              { style: { fontSize: '11px', color: m.hasKey ? 'rgba(127,127,127,0.85)' : '#c0392b' } },
              m.hasKey ? TEXT.hasKey : TEXT.noKey,
            ),
            inRace ? h('span', { style: { fontSize: '11px', color: 'rgba(127,127,127,0.85)' } }, TEXT.raceIn) : null,
            inRace
              ? null
              : smallBtn(
                  TEXT.raceAdd,
                  {},
                  function () {
                    onAddRace(m)
                  },
                  !m.hasKey || busy,
                ),
            isActive
              ? h('span', { style: { fontSize: '12px', color: 'rgba(127,127,127,0.85)' } }, TEXT.current)
              : smallBtn(
                  TEXT.pick,
                  {},
                  function () {
                    onApply(m)
                  },
                  !m.hasKey,
                ),
          ),
          proxyRow,
        )
      }

      // One roster entry in the race section.
      function RaceRow(props) {
        var r = props.r
        var index = props.index
        var onRemove = props.onRemove
        var onTest = props.onTest
        var testState = props.testState || null // null | { running } | { ok, summary, error, durationMs }
        var testing = !!(testState && testState.running)
        var detail = null
        if (testState && !testState.running) {
          if (testState.ok) {
            detail = h(
              'div',
              { style: { fontSize: '11px', margin: '2px 0 2px 20px', color: '#1e8e3e' } },
              '✓ ' +
                TEXT.raceOk +
                '（' +
                Math.round((testState.durationMs || 0) / 1000) +
                's）' +
                (testState.summary ? ' — ' + String(testState.summary).slice(0, 120) : ''),
            )
          } else {
            var errText = String(testState.error || '未知错误')
            var friendly = errText
            if (/not a valid model ID|invalid model/i.test(errText))
              friendly = '模型名无效 — 上游端点不认识这个名字，检查模型名拼写或该模型是否已下线'
            else if (/No endpoints.*image|does not support image|image input/i.test(errText))
              friendly = '不支持图片输入 — 这个模型不是视觉模型，不能用来看图'
            else if (/non-JSON output|not JSON/i.test(errText))
              friendly = '返回格式不对 — 模型没有按要求的 JSON 返回（多半不是视觉模型或不支持 structuredOutput）'
            else if (/429|rate.?limit|quota/i.test(errText)) friendly = '限流/配额不足 — 429，免费档常见，过会儿再试'
            else if (/401|Forbidden|invalid.*key|Unauthorized/i.test(errText))
              friendly = '认证失败 — API Key 无效或过期'
            else if (/timeout|aborted/i.test(errText))
              friendly = '超时 — 端点响应太慢（时长超 ' + Math.round((testState.durationMs || 0) / 1000) + 's 被终止）'
            else if (/500|502|503|upstream/i.test(errText)) friendly = '上游服务错误 — 端点或中转站故障，稍后重试'
            detail = h(
              'div',
              { style: { fontSize: '11px', margin: '2px 0 2px 20px', color: '#c0392b' } },
              h('div', null, '✗ ' + TEXT.raceFail + '：' + friendly),
              h(
                'div',
                { style: { color: 'rgba(127,127,127,0.6)', marginTop: '1px', wordBreak: 'break-all' } },
                '原始错误：' + errText.slice(0, 200),
              ),
            )
          }
        }
        return h(
          'div',
          { style: { padding: '6px 0', borderTop: '1px dashed rgba(127,127,127,0.2)' } },
          h(
            'div',
            { style: { display: 'flex', alignItems: 'center', gap: '8px' } },
            h('span', { style: { fontSize: '11px', color: 'rgba(127,127,127,0.6)', flex: 'none' } }, '#' + (index + 1)),
            h(
              'div',
              { style: { flex: 1, minWidth: 0 } },
              h(
                'div',
                { style: { fontSize: '12px', fontWeight: 600 } },
                r.name || r.provider + '/' + (r.model || '(default)'),
              ),
              h(
                'div',
                { style: { fontSize: '11px', color: 'rgba(127,127,127,0.75)' } },
                r.provider +
                  (r.baseUrl ? ' · ' + r.baseUrl : ' · 共享modlens配置') +
                  (r.hasKey ? '' : ' · 无Key') +
                  (r.proxy ? ' · 代理' : ''),
              ),
            ),
            testing
              ? h(
                  'span',
                  { style: { fontSize: '11px', color: 'rgba(127,127,127,0.85)', flex: 'none' } },
                  TEXT.raceTesting,
                )
              : smallBtn(
                  TEXT.raceTest,
                  {},
                  function () {
                    onTest(index)
                  },
                  props.busy,
                ),
            smallBtn(
              TEXT.raceRemove,
              {},
              function () {
                onRemove(index)
              },
              props.busy,
            ),
          ),
          testing
            ? h(
                'div',
                { style: { fontSize: '11px', margin: '2px 0 2px 20px', color: 'rgba(127,127,127,0.85)' } },
                '正在用测试图单独调用这个模型…',
              )
            : null,
          detail,
        )
      }

      return function VisionPickerCard() {
        var openState = react.useState(false)
        var dataState = react.useState(null) // { models, active }
        var noteState = react.useState('')
        var raceState = react.useState(null) // { timeoutMs, staggerMs, racers }
        var raceNoteState = react.useState('')
        var raceBusyState = react.useState(false)
        var testState = react.useState(null)
        var testStatesState = react.useState({}) // per-roster-index single-model test state
        var readToolState = react.useState(null) // { enabled } — modlens_read_image switch
        var customState = react.useState({ baseUrl: '', model: '', apiKey: '', proxy: '' })
        var open = openState[0]
        var data = dataState[0]
        var note = noteState[0]
        var race = raceState[0]
        var raceNote = raceNoteState[0]
        var raceBusy = raceBusyState[0]
        var test = testState[0]
        var testStates = testStatesState[0]
        var readTool = readToolState[0]
        var custom = customState[0]

        var load = react.useCallback(function () {
          noteState[1]('')
          fetch('/vp/list')
            .then(function (r) {
              return r.json().then(function (b) {
                if (!r.ok) throw new Error(b.error || 'load failed')
                return b
              })
            })
            .then(function (next) {
              dataState[1](next)
              noteState[1]('')
            })
            .catch(function (e) {
              noteState[1](String(e && e.message ? e.message : e))
            })
        }, [])

        var loadRace = react.useCallback(function () {
          fetch('/vp/race')
            .then(function (r) {
              return r.json().then(function (b) {
                if (!r.ok) throw new Error(b.error || 'load failed')
                return b
              })
            })
            .then(function (next) {
              raceState[1](next)
            })
            .catch(function (e) {
              raceNoteState[1](String(e && e.message ? e.message : e))
            })
        }, [])

        var loadReadTool = react.useCallback(function () {
          fetch('/vp/readtool')
            .then(function (r) {
              return r.json().then(function (b) {
                if (!r.ok) throw new Error(b.error || 'load failed')
                return b
              })
            })
            .then(function (b) {
              readToolState[1]({ enabled: !!b.enabled })
            })
            .catch(function () {
              readToolState[1]({ enabled: true })
            })
        }, [])

        react.useEffect(
          function () {
            if (open && data === null) load()
            if (open && race === null) loadRace()
            if (open && readTool === null) loadReadTool()
          },
          [open, data, race, readTool, load, loadRace, loadReadTool],
        )

        var post = function (path, body, okNote) {
          raceBusyState[1](true)
          raceNoteState[1]('')
          return fetch(path, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
          })
            .then(function (r) {
              return r.json().then(function (b) {
                if (!r.ok) throw new Error(b.error || 'request failed')
                return b
              })
            })
            .then(function (next) {
              if (next && next.racers) raceState[1](next)
              raceNoteState[1](okNote || '')
              raceBusyState[1](false)
            })
            .catch(function (e) {
              raceNoteState[1](String(e && e.message ? e.message : e))
              raceBusyState[1](false)
            })
        }

        var applyModel = function (m) {
          noteState[1]('切换中…')
          fetch('/vp/apply', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ provider: m.provider, model: m.model }),
          })
            .then(function (r) {
              return r.json().then(function (b) {
                if (!r.ok) throw new Error(b.error || 'apply failed')
                return b
              })
            })
            .then(function () {
              noteState[1](TEXT.picked + ' → ' + m.model)
              load()
            })
            .catch(function (e) {
              noteState[1](String(e && e.message ? e.message : e))
            })
        }

        var setProxy = function (m, proxy) {
          return fetch('/vp/setproxy', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ provider: m.provider, model: m.model, proxy: proxy }),
          })
            .then(function (r) {
              return r.json().then(function (b) {
                if (!r.ok) throw new Error(b.error || 'setproxy failed')
                return b
              })
            })
            .then(function () {
              noteState[1](proxy === '' ? '代理已清除' : TEXT.proxySaved + ' → ' + m.model)
              return null
            })
        }

        var addRace = function (m) {
          post('/vp/race/add', { provider: m.provider, model: m.model }, '已加入竞速：' + m.model)
        }
        var removeRace = function (index) {
          post('/vp/race/remove', { index: index }, '已移出')
        }
        var testOneRacer = function (index) {
          testStatesState[1](function (prev) {
            var next = Object.assign({}, prev)
            next[index] = { running: true }
            return next
          })
          fetch('/vp/race/test-one', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ index: index }),
          })
            .then(function (r) {
              return r.json().then(function (b) {
                if (!r.ok) throw new Error(b.error || 'test failed')
                return b
              })
            })
            .then(function (b) {
              testStatesState[1](function (prev) {
                var next = Object.assign({}, prev)
                next[index] = {
                  running: false,
                  ok: !!b.ok,
                  summary: b.summary || '',
                  error: b.error || '',
                  durationMs: b.durationMs || 0,
                }
                return next
              })
            })
            .catch(function (e) {
              testStatesState[1](function (prev) {
                var next = Object.assign({}, prev)
                next[index] = {
                  running: false,
                  ok: false,
                  error: String(e && e.message ? e.message : e),
                  durationMs: 0,
                }
                return next
              })
            })
        }
        var testAllRacers = function () {
          var roster = race && Array.isArray(race.racers) ? race.racers : []
          for (var i = 0; i < roster.length; i++) testOneRacer(i)
        }
        var toggleReadTool = function () {
          var next = !(readTool && readTool.enabled)
          fetch('/vp/readtool/set', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ enabled: next }),
          })
            .then(function (r) {
              return r.json().then(function (b) {
                if (!r.ok) throw new Error(b.error || 'set failed')
                return b
              })
            })
            .then(function (b) {
              readToolState[1]({ enabled: !!b.enabled })
              raceNoteState[1](b.enabled ? 'modlens_read_image 已开启' : 'modlens_read_image 已关闭')
            })
            .catch(function (e) {
              raceNoteState[1](String(e && e.message ? e.message : e))
            })
        }
        var addCustom = function () {
          var c = {
            baseUrl: custom.baseUrl.trim(),
            model: custom.model.trim(),
            apiKey: custom.apiKey.trim(),
            proxy: custom.proxy.trim(),
          }
          if (!c.baseUrl || !c.model || !c.apiKey) {
            raceNoteState[1]('自定义 racer 需要 baseUrl + 模型名 + Key')
            return
          }
          post('/vp/race/add', { custom: c }, '已加入竞速：' + c.model).then(function () {
            customState[1]({ baseUrl: '', model: '', apiKey: '', proxy: '' })
          })
        }
        var saveSettings = function () {
          post(
            '/vp/race/settings',
            { timeoutMs: Number(race && race.timeoutMs) || 90000, staggerMs: Number(race && race.staggerMs) || 0 },
            '设置已保存',
          )
        }
        var runTest = function () {
          raceBusyState[1](true)
          raceNoteState[1](TEXT.raceTesting)
          testState[1](null)
          fetch('/vp/race/test', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
            .then(function (r) {
              return r.json().then(function (b) {
                if (!r.ok) throw new Error(b.error || 'test failed')
                return b
              })
            })
            .then(function (b) {
              testState[1](b)
              raceNoteState[1](b.ok ? '' : '全部 racer 失败，看下方明细')
              raceBusyState[1](false)
            })
            .catch(function (e) {
              raceNoteState[1](String(e && e.message ? e.message : e))
              raceBusyState[1](false)
            })
        }

        var body = null
        if (open) {
          var inner
          if (data === null) {
            inner = h(
              'div',
              { style: { padding: '12px 0', color: 'rgba(127,127,127,0.8)', fontSize: '13px' } },
              note || TEXT.loading,
            )
          } else {
            var models = data && Array.isArray(data.models) ? data.models : []
            var active = (data && data.active) || {}
            var raceRoster = race && Array.isArray(race.racers) ? race.racers : []
            var isInRace = function (m) {
              return raceRoster.some(function (r) {
                return r.model === m.model && r.baseUrl === m.baseUrl
              })
            }
            var rows
            if (models.length === 0) {
              rows = h(
                'div',
                { style: { padding: '12px 0', color: 'rgba(127,127,127,0.8)', fontSize: '13px' } },
                TEXT.empty,
              )
            } else {
              rows = models.map(function (m) {
                var isActive = active.model === m.model && active.baseUrl === m.baseUrl
                return h(ModelRow, {
                  key: m.provider + '|' + m.model,
                  m: m,
                  isActive: isActive,
                  inRace: isInRace(m),
                  onApply: applyModel,
                  onSetProxy: setProxy,
                  onAddRace: addRace,
                })
              })
            }

            // ---- race section ----
            var rosterRows =
              raceRoster.length === 0
                ? h(
                    'div',
                    { style: { padding: '8px 0', color: 'rgba(127,127,127,0.8)', fontSize: '12px' } },
                    TEXT.raceEmpty,
                  )
                : raceRoster.map(function (r, i) {
                    return h(RaceRow, {
                      key: r.provider + '|' + r.model + '|' + r.baseUrl + '|' + i,
                      r: r,
                      index: i,
                      onRemove: removeRace,
                      onTest: testOneRacer,
                      testState: testStates[i] || null,
                      busy: raceBusy,
                    })
                  })

            var testBlock = null
            if (test) {
              var race = (test && test.race) || {}
              var attempts = Array.isArray(race.attempts) ? race.attempts : []
              testBlock = h(
                'div',
                { style: { padding: '8px 0', borderTop: '1px solid rgba(127,127,127,0.2)', fontSize: '12px' } },
                h(
                  'div',
                  { style: { fontWeight: 600, color: test.ok ? 'inherit' : '#c0392b' } },
                  test.ok
                    ? TEXT.raceWinner +
                        ' ' +
                        (race.winner || '?') +
                        '（' +
                        Math.round((race.durationMs || 0) / 1000) +
                        's）'
                    : '全部 racer 失败',
                ),
                test.summary
                  ? h('div', { style: { color: 'rgba(127,127,127,0.85)', marginTop: '2px' } }, test.summary)
                  : null,
                attempts.map(function (a, i) {
                  return h(
                    'div',
                    { key: i, style: { color: 'rgba(127,127,127,0.85)', marginTop: '2px' } },
                    (a.ok ? '✓ ' : '✗ ') +
                      a.provider +
                      '/' +
                      (a.model || '(default)') +
                      ' ' +
                      Math.round((a.durationMs || 0) / 1000) +
                      's' +
                      (a.error ? ' — ' + a.error : ''),
                  )
                }),
              )
            }

            var raceSection = h(
              'div',
              { style: { borderTop: '1px solid rgba(127,127,127,0.25)', marginTop: '10px', paddingTop: '8px' } },
              // modlens_read_image kill-switch row (applies immediately, no restart)
              h(
                'div',
                { style: { display: 'flex', alignItems: 'center', gap: '8px', padding: '2px 0 6px' } },
                h('span', { style: { fontSize: '12px', flex: 1, minWidth: 0 } }, TEXT.readToolLabel),
                h(
                  'span',
                  {
                    style: {
                      fontSize: '11px',
                      color: readTool && readTool.enabled ? '#1e8e3e' : '#c0392b',
                      flex: 'none',
                    },
                  },
                  readTool && readTool.enabled ? TEXT.readToolOn : TEXT.readToolOff,
                ),
                smallBtn(
                  readTool && readTool.enabled ? TEXT.readToolDisable : TEXT.readToolEnable,
                  {},
                  toggleReadTool,
                  !readTool,
                ),
              ),
              h(
                'div',
                { style: { fontSize: '11px', color: 'rgba(127,127,127,0.75)', margin: '0 0 4px' } },
                readTool && readTool.enabled ? TEXT.readToolHintOn : TEXT.readToolHintOff,
              ),
              h('div', { style: { fontSize: '13px', fontWeight: 600, marginBottom: '2px' } }, TEXT.raceTitle),
              rosterRows,
              // custom racer form
              h(
                'div',
                { style: { fontSize: '12px', color: 'rgba(127,127,127,0.85)', margin: '8px 0 4px' } },
                TEXT.raceCustom,
              ),
              h(
                'div',
                { style: { display: 'flex', gap: '6px', margin: '4px 0' } },
                h('input', {
                  type: 'text',
                  value: custom.baseUrl,
                  placeholder: TEXT.raceCustomBase,
                  onChange: function (e) {
                    customState[1]({
                      baseUrl: e.target.value,
                      model: custom.model,
                      apiKey: custom.apiKey,
                      proxy: custom.proxy,
                    })
                  },
                  style: inputStyle,
                }),
              ),
              h(
                'div',
                { style: { display: 'flex', gap: '6px', margin: '4px 0' } },
                h('input', {
                  type: 'text',
                  value: custom.model,
                  placeholder: TEXT.raceCustomModel,
                  onChange: function (e) {
                    customState[1]({
                      baseUrl: custom.baseUrl,
                      model: e.target.value,
                      apiKey: custom.apiKey,
                      proxy: custom.proxy,
                    })
                  },
                  style: inputStyle,
                }),
                h('input', {
                  type: 'password',
                  value: custom.apiKey,
                  placeholder: TEXT.raceCustomKey,
                  onChange: function (e) {
                    customState[1]({
                      baseUrl: custom.baseUrl,
                      model: custom.model,
                      apiKey: e.target.value,
                      proxy: custom.proxy,
                    })
                  },
                  style: inputStyle,
                }),
              ),
              h(
                'div',
                { style: { display: 'flex', gap: '6px', margin: '4px 0 6px' } },
                h('input', {
                  type: 'text',
                  value: custom.proxy,
                  placeholder: TEXT.raceCustomProxy,
                  onChange: function (e) {
                    customState[1]({
                      baseUrl: custom.baseUrl,
                      model: custom.model,
                      apiKey: custom.apiKey,
                      proxy: e.target.value,
                    })
                  },
                  style: inputStyle,
                }),
                smallBtn(TEXT.raceAddCustom, {}, addCustom, raceBusy),
              ),
              // settings + test
              h(
                'div',
                { style: { display: 'flex', alignItems: 'center', gap: '6px', margin: '6px 0' } },
                h(
                  'span',
                  { style: { fontSize: '12px', color: 'rgba(127,127,127,0.85)', flex: 'none' } },
                  TEXT.raceTimeout,
                ),
                h('input', {
                  type: 'number',
                  value: (race && race.timeoutMs) || 90000,
                  onChange: function (e) {
                    raceState[1]({ timeoutMs: e.target.value, staggerMs: race.staggerMs, racers: race.racers })
                  },
                  style: {
                    font: 'inherit',
                    fontSize: '12px',
                    padding: '4px 8px',
                    borderRadius: '6px',
                    border: '1px solid rgba(127,127,127,0.35)',
                    background: 'transparent',
                    color: 'inherit',
                    width: '90px',
                  },
                }),
                h(
                  'span',
                  { style: { fontSize: '12px', color: 'rgba(127,127,127,0.85)', flex: 'none' } },
                  TEXT.raceStagger,
                ),
                h('input', {
                  type: 'number',
                  value: (race && race.staggerMs) || 0,
                  onChange: function (e) {
                    raceState[1]({ timeoutMs: race.timeoutMs, staggerMs: e.target.value, racers: race.racers })
                  },
                  style: {
                    font: 'inherit',
                    fontSize: '12px',
                    padding: '4px 8px',
                    borderRadius: '6px',
                    border: '1px solid rgba(127,127,127,0.35)',
                    background: 'transparent',
                    color: 'inherit',
                    width: '90px',
                  },
                }),
                smallBtn(TEXT.raceSaveSettings, {}, saveSettings, raceBusy),
                smallBtn(TEXT.raceTest, {}, runTest, raceBusy),
                smallBtn(TEXT.raceTestAll, {}, testAllRacers, raceBusy),
              ),
              h(
                'div',
                { style: { display: 'flex', alignItems: 'center', gap: '8px' } },
                h('span', { role: 'status', style: { fontSize: '12px', color: 'rgba(127,127,127,0.85)' } }, raceNote),
              ),
              testBlock,
            )

            inner = h(
              'div',
              null,
              rows,
              h(
                'div',
                {
                  style: {
                    borderTop: '1px solid rgba(127,127,127,0.25)',
                    display: 'flex',
                    justifyContent: 'flex-end',
                    alignItems: 'center',
                    gap: '8px',
                    padding: '10px 0 4px',
                  },
                },
                h(
                  'span',
                  { role: 'status', style: { marginRight: 'auto', fontSize: '12px', color: 'rgba(127,127,127,0.85)' } },
                  note,
                ),
                h(
                  'button',
                  {
                    type: 'button',
                    onClick: function () {
                      load()
                      loadRace()
                    },
                    style: {
                      font: 'inherit',
                      fontSize: '12px',
                      cursor: 'pointer',
                      border: '1px solid rgba(127,127,127,0.35)',
                      borderRadius: '6px',
                      padding: '4px 12px',
                      background: 'none',
                      color: 'inherit',
                    },
                  },
                  TEXT.refresh,
                ),
              ),
              raceSection,
            )
          }
          body = h('div', { style: { margin: '0 16px', paddingBottom: '8px' } }, inner)
        }

        return h(
          'div',
          {
            style: {
              border: '1px solid rgba(127,127,127,0.3)',
              background: open ? 'rgba(127,127,127,0.10)' : 'rgba(127,127,127,0.05)',
              borderRadius: '12px',
              transition: 'border-color .16s, background .16s',
            },
          },
          h(
            'button',
            {
              type: 'button',
              'aria-expanded': open,
              onClick: function () {
                openState[1](!open)
              },
              style: {
                appearance: 'none',
                width: '100%',
                font: 'inherit',
                color: 'inherit',
                textAlign: 'left',
                cursor: 'pointer',
                background: 'none',
                border: 0,
                borderRadius: '12px',
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
                padding: '14px 16px',
              },
            },
            h(
              'div',
              { style: { flex: 1, minWidth: 0 } },
              h('div', { style: { fontSize: '14px', fontWeight: 600 } }, TEXT.title),
              h('div', { style: { color: 'rgba(127,127,127,0.8)', fontSize: '13px', lineHeight: 1.5 } }, TEXT.subtitle),
            ),
            chevron(open),
          ),
          body,
        )
      }
    }

    function apply(ctx) {
      var react
      try {
        react = require('react')
      } catch (error) {
        console.error('[dsh-vision-picker] card skipped: ' + error)
        return
      }
      var CardCmp = Card(react)
      ctx.slots.inject('settings.general.item', function () {
        return ctx.slots.register({ name: 'settings.general.item', id: 'vision-picker', order: 1 }, CardCmp)
      })
    }

    exports.apply = apply
    exports.inject = ['slots']
    return module.exports
  },
})
