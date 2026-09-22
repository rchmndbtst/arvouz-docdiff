import * as vscode from 'vscode';

let channel: vscode.LogOutputChannel | undefined;

export function getLog(): vscode.LogOutputChannel {
  if (!channel) {
    channel = vscode.window.createOutputChannel('GitDoc', { log: true });
  }
  return channel;
}
