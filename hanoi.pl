%  Tower of Hanoi - game engine and web server in SWI-Prolog
%  Run:   swipl hanoi.pl     (then open http://localhost:8080/)
%  Test:  swipl -g test -t halt hanoi.pl
%
%  Prolog owns the rules: it solves the puzzle, validates every move,
%  counts moves and detects completion. The browser page (index.html)
%  only draws the rings, animates them and plays sounds.

:- use_module(library(http/thread_httpd)).
:- use_module(library(http/http_dispatch)).
:- use_module(library(http/http_parameters)).
:- use_module(library(http/http_json)).
:- use_module(library(filesex)).
:- use_module(library(www_browser)).
:- use_module(library(lists)).
:- use_module(library(http/http_cors)).
:- set_setting(http:cors, [*]).     % lets the page talk to Prolog even if opened from Live Server

:- dynamic state/3, base_dir/1.      % state(N, Pegs, Moves); pegs hold disks top-first
:- prolog_load_context(directory, D), assertz(base_dir(D)).

%% ---------- Game logic ----------

% hanoi(+N, +From, +To, +Via, -Moves): recursive solution, pegs are 0, 1, 2.
hanoi(0, _, _, _, []) :- !.
hanoi(N, From, To, Via, Moves) :-
    N1 is N - 1,
    hanoi(N1, From, Via, To, M1),
    hanoi(N1, Via, To, From, M2),
    append(M1, [[From, To]|M2], Moves).

min_moves(N, Min) :- Min is (1 << N) - 1.            % 2^N - 1

% legal(+Pegs, +From, +To, -Disk): official rules.
legal(Pegs, F, T, D) :-
    F \== T,
    nth0(F, Pegs, [D|_]),                            % only the top disk moves
    nth0(T, Pegs, Dst),
    (   Dst == []
    ;   Dst = [Top|_], D < Top                       % never larger on smaller
    ).

move_disk(Pegs, F, T, New) :-
    legal(Pegs, F, T, D),
    numlist(0, 2, Is),
    maplist(update_peg(F, T, D, Pegs), Is, New).

update_peg(F, T, D, Pegs, I, Peg) :-
    nth0(I, Pegs, Old),
    (   I == F -> Old = [_|Peg]
    ;   I == T -> Peg = [D|Old]
    ;   Peg = Old
    ).

reset_game(N) :-
    retractall(state(_, _, _)),
    numlist(1, N, Disks),
    assertz(state(N, [Disks, [], []], 0)).

%% ---------- Self-test (3 to 8 disks) ----------

test :- forall(between(3, 8, N), test(N)).
test(N) :-
    hanoi(N, 0, 2, 1, Ms), length(Ms, L), min_moves(N, Min),
    numlist(1, N, Disks),
    (   foldl(step, Ms, [Disks, [], []], Final),
        Final = [[], [], Disks], L =:= Min
    ->  format("~w disks: pass (~w moves)~n", [N, L])
    ;   format("~w disks: FAIL~n", [N])
    ).
step([F, T], P0, P) :- move_disk(P0, F, T, P).

%% ---------- HTTP API ----------

:- http_handler(root(.),         serve_index, []).
:- http_handler(root(api/reset), api_reset, []).
:- http_handler(root(api/solve), api_solve, []).
:- http_handler(root(api/move),  api_move,  []).

serve_index(_Request) :-
    base_dir(D), directory_file_path(D, 'index.html', File),
    read_file_to_string(File, Html, [encoding(utf8)]),
    format("Content-type: text/html; charset=UTF-8~n~n"),
    write(Html).

api_reset(Request) :-
    cors_enable,
    http_parameters(Request, [n(N, [between(3, 8)])]),
    reset_game(N), min_moves(N, Min),
    reply_json_dict(_{n: N, min: Min}).

api_solve(Request) :-
    cors_enable,
    http_parameters(Request, [n(N, [between(3, 8)])]),
    hanoi(N, 0, 2, 1, Moves), min_moves(N, Min),
    reply_json_dict(_{moves: Moves, min: Min}).

api_move(Request) :-
    cors_enable,
    http_parameters(Request, [from(F, [between(0, 2)]), to(T, [between(0, 2)])]),
    (   state(N, P0, M0), move_disk(P0, F, T, P1)
    ->  retractall(state(_, _, _)),
        M1 is M0 + 1,
        assertz(state(N, P1, M1)),
        (   P1 = [[], [], Full], length(Full, N) -> Solved = true ; Solved = false ),
        reply_json_dict(_{ok: true, moves: M1, solved: Solved})
    ;   reply_json_dict(_{ok: false})
    ).

%% ---------- Start ----------

start :- start(8080).
start(Port) :-
    reset_game(5),
    catch(http_server(http_dispatch, [port(Port)]), E,
          ( print_message(error, E),
            format("Could not start on port ~w. Try another port in hanoi.pl.~n", [Port]),
            fail )),
    format(atom(URL), 'http://localhost:~w/', [Port]),
    format("~nTower of Hanoi is running at ~w~nPress Ctrl+C twice to stop.~n", [URL]),
    catch(www_open_url(URL), _, true).

:- initialization(maybe_start).
maybe_start :-                       % do not start the server when only running the test
    current_prolog_flag(os_argv, Args),
    (   memberchk(test, Args) -> true ; start ).
