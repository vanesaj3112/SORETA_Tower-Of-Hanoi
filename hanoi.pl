% Tower of Hanoi - Prolog engine (runs in the browser through Tau Prolog)
% Pegs are numbered 0, 1, 2. Each peg is a list of disks, top disk first.
% Smaller number = smaller disk.

% hanoi(+N, +From, +To, +Via, -Moves): recursive solution as [[From,To],...]
hanoi(0, _, _, _, []) :- !.
hanoi(N, From, To, Via, Moves) :-
    N1 is N - 1,
    hanoi(N1, From, Via, To, M1),
    hanoi(N1, Via, To, From, M2),
    join(M1, [[From, To]|M2], Moves).

join([], L, L).
join([H|T], L, [H|R]) :- join(T, L, R).

% min_moves(+N, -Min): Min = 2^N - 1
min_moves(0, 0) :- !.
min_moves(N, Min) :-
    N1 is N - 1,
    min_moves(N1, M1),
    Min is 2 * M1 + 1.

% peg(+Index, +Pegs, -Peg)
peg(0, [A, _, _], A).
peg(1, [_, B, _], B).
peg(2, [_, _, C], C).

% legal(+Pegs, +From, +To): only the top disk moves, never a larger disk on a smaller one
legal(Pegs, From, To) :-
    From \== To,
    peg(From, Pegs, [Disk|_]),
    peg(To, Pegs, Dest),
    (   Dest == []
    ;   Dest = [Top|_], Disk < Top
    ).
