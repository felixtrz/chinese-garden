#!/bin/sh
# Usage: tools/sheet.sh <dir> <out.png> <files...>  -> 3-column contact sheet, 480px tiles
dir=$1; out=$2; shift 2
args=""; n=0
for f in "$@"; do args="$args -i $dir/$f.png"; n=$((n+1)); done
rows=$(( (n + 2) / 3 ))
filter=""
i=0
for f in "$@"; do filter="$filter[$i:v]scale=480:300[v$i];"; i=$((i+1)); done
inputs=""; i=0; while [ $i -lt $n ]; do inputs="$inputs[v$i]"; i=$((i+1)); done
layout=""; i=0
while [ $i -lt $n ]; do c=$((i % 3)); r=$((i / 3)); x=$((c*480)); y=$((r*300)); [ -n "$layout" ] && layout="$layout|"; layout="${layout}${x}_${y}"; i=$((i+1)); done
ffmpeg -loglevel error -y $args -filter_complex "${filter}${inputs}xstack=inputs=$n:layout=$layout:fill=black" "$out"
