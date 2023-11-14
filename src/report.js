'use strict';

const fs = require('fs');
const nodemailer = require('nodemailer');
const path = require('path');
const { execSync } = require('child_process');
const util = require('./util.js');

async function sendMail(to, subject, html) {
  let from = 'webgraphics@intel.com';

  let transporter = nodemailer.createTransport({
    host: 'ecsmtp.sh.intel.com',
    port: 25,
    secure: false,
    auth: false,
  });

  transporter.verify(error => {
    if (error)
      util.log('transporter error: ', error);
    else
      util.log('Email was sent!');
  });

  let info = await transporter.sendMail({
    from: from,
    to: to,
    subject: subject,
    html: html,
  });
  return Promise.resolve();
}

function getSortedHash(inputHash) {
  var resultHash = {};

  var keys = Object.keys(inputHash);
  keys.sort(function (a, b) {
    return inputHash[a][0] - inputHash[b][0];
  })
    .reverse()
    .forEach(function (k) {
      resultHash[k] = inputHash[k];
    });
  return resultHash;
}

async function report(results) {
  const goodStyle = 'style=color:green';
  const badStyle = 'style=color:red';
  const neutralStyle = 'style=color:black';
  let epsLength = util.allEps.length;

  // main performance and conformance tables
  let benchmarkTables = '';
  for (let task of ['performance', 'conformance']) {
    if (!(task in results)) {
      continue;
    }
    let taskResults = results[task];
    let metrics = util.taskMetrics[task];
    let metricsLength = metrics.length;
    // for errorMsg
    if (task === 'conformance') {
      metricsLength += 1;
    }
    let unit;
    if (task === 'performance') {
      unit = ' (ms)';
    } else {
      unit = '';
    }

    for (let metricIndex = 0; metricIndex < metrics.length; metricIndex++) {
      let metric = metrics[metricIndex];
      let benchmarkTable = `<table>`;

      // header
      benchmarkTable += `<tr><th>${task} (${metric})</th>`;
      for (let epIndex = 0; epIndex < epsLength;
        epIndex++) {
        let ep = util.allEps[epIndex];
        if ((task === 'conformance' &&
          util.conformanceEps.indexOf(ep) < 0) ||
          (task === 'performance' &&
            util.performanceEps.indexOf(ep) < 0)) {
          continue;
        }

        if (metric === 'Subsequent average') {
          benchmarkTable += `<th>${ep} total${unit}</th>`;
          if (util.breakdown) {
            benchmarkTable += `<th>${ep} ops${unit}</th>`;
          }
        } else {
          benchmarkTable += `<th>${ep}${unit}</th>`;
          if (task === 'conformance') {
            benchmarkTable += `<th>${ep} error</th>`;
          }
        }

        if (task === 'performance' && ep !== 'webgpu') {
          if (metric === 'Subsequent average') {
            benchmarkTable += `<th>webgpu total vs ${ep} total (%)</th>`
            if (util.breakdown) {
              benchmarkTable += `<th>webgpu ops vs ${ep} ops (%)</th>`;
            }
          } else {
            benchmarkTable += `<th>webgpu vs ${ep} (%)</th>`;
          }
        }
      }
      benchmarkTable += '</tr>';

      // body
      for (let resultIndex = 0; resultIndex < taskResults.length;
        resultIndex++) {
        let result = taskResults[resultIndex];
        let opsResult = result[result.length - 1];
        benchmarkTable += `<tr><td>${result[0]}</td>`;

        let webgpuTotalValue = 'NA';
        let webgpuOpsValue = 'NA';
        for (let epIndex = 0; epIndex < epsLength;
          epIndex++) {
          let ep = util.allEps[epIndex];
          if ((task === 'conformance' &&
            util.conformanceEps.indexOf(ep) < 0) ||
            (task === 'performance' &&
              util.performanceEps.indexOf(ep) < 0)) {
            continue;
          }

          let epTotalValue =
            result[epIndex * metricsLength + metricIndex + 1];
          let epOpsValue = 0.0;
          for (let op in opsResult) {
            epOpsValue += opsResult[op][epIndex];
          }
          epOpsValue = parseFloat(epOpsValue).toFixed(2);
          if (ep === 'webgpu') {
            webgpuTotalValue = epTotalValue;
            webgpuOpsValue = epOpsValue;
          }
          let style = neutralStyle;
          if (task === 'conformance') {
            if (epTotalValue === 'false') {
              style = badStyle;
            } else if (epTotalValue === 'true') {
              style = goodStyle;
            }
          }
          benchmarkTable += `<td ${style}>${epTotalValue}</td>`;
          if (task === 'conformance') {
            benchmarkTable += `<td>${result[epIndex * metricsLength + metricIndex + 2]}</td>`;
          }
          if (metric === 'Subsequent average' && util.breakdown) {
            benchmarkTable += `<td>${epOpsValue}</td>`
          }
          if (task === 'performance' && ep !== 'webgpu') {
            let totalPercent = 'NA';
            let totalStyle = neutralStyle;
            if (epTotalValue !== 'NA' && webgpuTotalValue !== 'NA') {
              totalPercent =
                parseFloat(epTotalValue / webgpuTotalValue * 100)
                  .toFixed(2);
              totalStyle = totalPercent > 100 ? goodStyle : badStyle;
            }
            benchmarkTable += `<td ${totalStyle}>${totalPercent}</td>`;

            if (metric === 'Subsequent average' && util.breakdown) {
              let opsPercent = 'NA';
              let opsStyle = neutralStyle;
              if (epOpsValue !== 'NA' && webgpuOpsValue !== 'NA') {
                opsPercent = parseFloat(epOpsValue / webgpuOpsValue * 100)
                  .toFixed(2);
                opsStyle = opsPercent > 100 ? goodStyle : badStyle;
              }
              benchmarkTable += `<td ${opsStyle}>${opsPercent}</td>`;
            }
          }
        }
        benchmarkTable += '</tr>';
      }

      benchmarkTable += '</table><br>';
      benchmarkTables += benchmarkTable;
    }
  }

  // unit table
  let unitTable = '';
  if ('unit' in results) {
    let taskResults = results['unit'];
    unitTable = `<table><tr><th>unit</th><th>webgpu</th>`;
    for (let epIndex = 1; epIndex < epsLength; epIndex++) {
      let ep = util.allEps[epIndex];
      unitTable += `<th>${ep}</th>`;
    }
    unitTable += '</tr>';

    unitTable += '<tr><td></td>';
    for (let epIndex = 0; epIndex < epsLength; epIndex++) {
      let style;
      if (taskResults[epIndex] === 'NA') {
        style = neutralStyle;
      } else if (taskResults[epIndex].includes('FAILED')) {
        style = badStyle;
      } else {
        style = goodStyle;
      }
      unitTable += `<td ${style}>${taskResults[epIndex]}</td>`;
    }
    unitTable += '</tr></table><br>';
  }

  // config table
  let configTable = '<table><tr><th>Category</th><th>Info</th></tr>';
  if ('upload' in util.args || 'server-info' in util.args) {
    util['serverRepoCommit'] =
      execSync(util.ssh('"cd /workspace/project/onnxruntime && git rev-parse HEAD"'))
        .toString();
  }

  for (let category
    of ['browserArgs', 'browserPath', 'chromeRevision', 'chromeVersion', 'clientRepoCommit',
      'clientRepoDate', 'cpuName', 'crossOriginIsolated', 'duration', 'gpuDeviceId',
      'gpuDriverVersion', 'gpuName', 'hostname', 'osVersion', 'platform', 'runTimes', 'serverRepoCommit',
      'toolkitUrl', 'toolkitUrlArgs', 'warmupTimes', 'wasmThreads']) {
    let categoryFixup;
    if (category === 'duration') {
      categoryFixup = `${category} (s)`;
    } else {
      categoryFixup = category;
    }

    configTable += `<tr><td>${categoryFixup}</td><td>${util[category]}</td></tr>`;
  }
  configTable += '</table><br>'

  // performance breakdown table
  let breakdownTable = '';
  let task = 'performance';
  if (task in results && util.breakdown) {
    let taskResults = results[task];
    let epsLength = util.allEps.length;
    let metricsLength = util.taskMetrics[task].length;
    let unit = ' (ms)';
    let style = neutralStyle;
    breakdownTable =
      `<table><tr><th>model</th><th>op</th><th>webgpu${unit}</th>`;
    for (let epIndex = 1; epIndex < epsLength; epIndex++) {
      let ep = util.allEps[epIndex];
      breakdownTable += `<th>${ep}${unit}</th>`;
      breakdownTable += `<th>webgpu vs ${ep} (%)</th>`;
    }
    breakdownTable += '</tr>';

    for (let resultIndex = 0; resultIndex < taskResults.length;
      resultIndex++) {
      let result = taskResults[resultIndex];
      let op_time = result[epsLength * metricsLength + 1];
      let TOP = 5;
      let enableTOP = false;
      let count = 0;
      let modelNameDisplayed = false;

      for (let op in getSortedHash(op_time)) {
        let time = op_time[op];
        let webgpuTotalValue = time[0];
        let modelName;
        if (modelNameDisplayed) {
          modelName = '';
        } else {
          modelName = result[0];
          modelNameDisplayed = true;
        }

        breakdownTable += `<tr><td>${modelName}</td><td>${op}</td><td ${style}>${webgpuTotalValue}</td>`;
        for (let epIndex = 1; epIndex < epsLength;
          epIndex++) {
          let epTotalValue = time[epIndex];
          breakdownTable += `<td>${epTotalValue}</td>`;
          let percent = 'NA';
          let style = neutralStyle;
          if (epTotalValue !== 'NA' && webgpuTotalValue !== 'NA') {
            percent = parseFloat(epTotalValue / webgpuTotalValue * 100)
              .toFixed(2);
            style = percent > 100 ? goodStyle : badStyle;
          }
          breakdownTable += `<td ${style}>${percent}</td>`;
        }
        breakdownTable += '</tr>';
        count += 1;
        if (enableTOP && count === TOP) {
          break;
        }
      }
    }
    breakdownTable += '</table><br>';
  }

  let style = '<style> \
		* {font-family: Calibri (Body);} \
	  table {border-collapse: collapse;} \
	  table, td, th {border: 1px solid black; vertical-align: top;} \
	  th {background-color: #0071c5; color: #ffffff; font-weight: normal;} \
    </style>';

  let html = style + configTable + unitTable + benchmarkTables + breakdownTable;

  fs.writeFileSync(
    path.join(util.timestampDir, `${util.timestamp}.html`), html);

  if ('email' in util.args) {
    let subject = '[ORT-TEST] ' + util['hostname'] + ' ' + util.timestamp;
    await sendMail(util.args['email'], subject, html);
  }
}

module.exports = report;
